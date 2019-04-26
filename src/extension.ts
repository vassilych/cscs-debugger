/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import * as Net from 'net';
import * as Path from 'path';

import { CscsRuntime } from './cscsRuntime';
import { MainPanel, REPLSerializer } from './webview';


export function activate(context: vscode.ExtensionContext) {
	let outputChannel = vscode.window.createOutputChannel('CSCS');

	let init          = true;
	const getConnectionData = () : [string, string, number] =>  {
		const config      = vscode.workspace.getConfiguration('cscs');
		let connectType   = config.get('connectType', 'sockets');
		let host          = config.get('serverHost',  '127.0.0.1');
		let port          = config.get('serverPort',  13337);
		return [connectType, host, port];
	};

	let [connectType, host, port] = getConnectionData();

	const registeredCommand = () => {
		let textEditor = vscode.window.activeTextEditor;
		if (textEditor && textEditor.document && textEditor.document.fileName) {
			let filename  = Path.parse(textEditor.document.fileName).base;
			return filename;
		}
		return vscode.window.showInputBox({
			placeHolder: "Enter the name of a CSCS file in the workspace folder",
			value: "test.cscs"
		});
	};

	context.subscriptions.push(vscode.commands.registerCommand(
		'extension.cscs-debug.getProgramName', registeredCommand));
	context.subscriptions.push(vscode.commands.registerCommand(
		'extension.cscs-debug.runLocal', registeredCommand));

	const initRuntime = (cscsRuntime : CscsRuntime) => {

		cscsRuntime.on('onInfoMessage', (msg : string) => {
			vscode.window.showInformationMessage(msg);
		});
		cscsRuntime.on('onStatusChange', (msg : string) => {
			MainPanel.status = msg;
			//if (MainPanel.currentPanel) {
			//	MainPanel.currentPanel.update();
			//}
			vscode.window.setStatusBarMessage(msg);
		});
		cscsRuntime.on('onWarningMessage', (msg : string) => {
			vscode.window.showWarningMessage('REPL: ' + msg);
		});
		cscsRuntime.on('onErrorMessage', (msg : string) => {
			vscode.window.showErrorMessage('REPL: ' + msg);
		});
	
		cscsRuntime.on('onReplMessage', (data : string) => {
			if (init && MainPanel.init) {
				return;
			}

			let fromWebview = cscsRuntime.lastReplSource() === '' && MainPanel.currentPanel;

			if (!fromWebview) {
				outputChannel.append('REPL> ');
			}
			let lines = data.split('\\n');
			if (lines.length === 1) {
				lines = data.split('\n');
			}
			let counter = 0;
			for (let i = 0; i < lines.length; i++) {
				let line = lines[i].trim();
				if (line === "repl") {
					continue;
				}
				if (line === "" && i === lines.length - 1) {
					break;
				}
				if (fromWebview && MainPanel.currentPanel) {
					MainPanel.currentPanel.sendReplResponse(line);
				} else {
					outputChannel.appendLine(line);
				}
	
				counter++;
				if (line !== '' && !line.startsWith('Exception thrown')) {
					if (!line.startsWith('"') && isNaN(Number(line))) {
						line = '"' + line + '"';
					}
					//respHistory.push(line);
				}
			}
			if (fromWebview) {
				return;
			}
			if (counter === 0) {
				outputChannel.appendLine("");
			}
			outputChannel.show(true);
		});
	};

	// CSCS REPLWeb View stuff
	context.subscriptions.push(vscode.commands.registerCommand('cscs.repl.start', () => {
		MainPanel.createOrShow(context.extensionPath);
		REPLSerializer.init();
	}));

	const getActiveFilename = () : string =>  {		
		let textEditor = vscode.window.activeTextEditor;
		if (!textEditor || !textEditor.document) {
			return "";
		}
		let filePath = Path.resolve(textEditor.document.fileName);
		return filePath;
	};

	MainPanel.setPath(context.extensionPath);
	REPLSerializer.getConnectionData = getConnectionData;
	REPLSerializer.initRuntime       = initRuntime;
	REPLSerializer.getActiveFilename = getActiveFilename;
	if (vscode.window.registerWebviewPanelSerializer) {
		// Make sure we register a serilizer in activation event
		vscode.window.registerWebviewPanelSerializer(MainPanel.viewType, {
			async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
				MainPanel.revive(webviewPanel, context.extensionPath);
			}
		});
	}

	let msgRuntime   = CscsRuntime.getInstance(true);
	initRuntime(msgRuntime);

	const getCode = () => {
		let textEditor = vscode.window.activeTextEditor;
		if (!textEditor) {
			return "";
		}
		let selection = textEditor.selection;
		let text = textEditor.document.getText(selection);
		if (textEditor.selection.start.line === textEditor.selection.end.line &&
			textEditor.selection.start.character === textEditor.selection.end.character) {
			text = textEditor.document.lineAt(textEditor.selection.start.line).text;
		}
		return text.trim();
	};
	const getAllText = () : string =>  {
		let textEditor = vscode.window.activeTextEditor;
		if (!textEditor || !textEditor.document) {
			return "";
		}
		let text = textEditor.document.getText();
		return text;
	};

	const replCore = (code: string) => {
		if (code === '') {
			return;
		}
		init = false;

		let cscsRuntime   = CscsRuntime.getNewInstance(true);
		[connectType, host, port] = getConnectionData();
		initRuntime(cscsRuntime);
		try {
			cscsRuntime.startRepl(connectType, host, port);
			cscsRuntime.sendRepl(code, getActiveFilename());
		} catch (err) {
			cscsRuntime.makeInvalid();
			vscode.window.showErrorMessage('REPL: ' + err);
		}
	};

	let disposable = vscode.commands.registerCommand('extension.cscs-debug.repl', () => {
		let code = getCode();
		replCore(code);
	});
	let disposable2 = vscode.commands.registerCommand('cscs.repl.all', () => {
		let code = getAllText();
		replCore(code);
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(disposable2);

	const providerCscs = new CscsConfigurationProvider()
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('cscs', providerCscs));
	context.subscriptions.push(providerCscs);
}

export function deactivate() {
	// nothing to do
}

class CscsConfigurationProvider implements vscode.DebugConfigurationProvider {

	private _server?: Net.Server;

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'cscs' ) {
				config.type = 'cscs';
				config.name = 'Launch';
				config.request = 'launch';
				config.program = '${file}';
				config.stopOnEntry = true;
			}
		}

		if (!config.program) {
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return undefined;	// abort launch
			});
		}

		let textEditor = vscode.window.activeTextEditor;
		if (textEditor && textEditor.document && textEditor.document.fileName) {
            config.program = textEditor.document.fileName;
		}

		return config;
	}

	dispose() {
		if (this._server) {
			this._server.close();
		}
	}
}
