/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import * as Net from 'net';
import * as Path from 'path';

//import { CscsRepl } from './cscsRepl';
import { CscsRuntime } from './cscsRuntime';


export function activate(context: vscode.ExtensionContext) {
	//const fs   = require('fs');
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

	let outputChannel = vscode.window.createOutputChannel('CSCS');

	let init          = true;
	const config      = vscode.workspace.getConfiguration('cscs');
	let connectType   = config.get('connectType', 'sockets');
	let host          = config.get('serverHost', '127.0.0.1');
	let port          = config.get('serverPort', 13337);

	let history       = new Array<string>();

	let cscsRuntime   = CscsRuntime.getInstance();
	CscsRuntime.startRepl(connectType, host, port);

	cscsRuntime.on('onInfoMessage', (msg : string) => {
		vscode.window.showInformationMessage(msg);
	});
	cscsRuntime.on('onWarningMessage', (msg : string) => {
		vscode.window.showWarningMessage('REPL: ' + msg);
	});
	cscsRuntime.on('onErrorMessage', (msg : string) => {
		vscode.window.showErrorMessage('REPL: ' + msg);
	});

	cscsRuntime.on('onReplMessage', (data : string) => {
		if (init) {
			return;
		}
		outputChannel.append('REPL> ');
		let lines = data.split('\\n');
		if (lines.length === 1) {
			lines = data.split('\n');
		}
		let counter = 0;
		for (let i = 0; i < lines.length; i++) {
			let line = lines[i].trim();
			if (i == 0 && line.startsWith("repl")) {
				continue;
			}
			if (line === "" && i == lines.length - 1) {
				break;
			}
			outputChannel.appendLine(line);
			counter++;
			if (line != '') {
				if (!line.startsWith('"')) {
					line = '"' + line + '"';
				}
				history.push(line);
			}
		}
		if (counter === 0) {
			outputChannel.appendLine("");
		}
	});

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

	const replaceReplHistory = (repl: string, index: number) => {
		let arrIndex = index > 0 ? history.length - 1 - index : -1 * index - 1;
		if (arrIndex >= history.length  || arrIndex < 0) {
			return repl;
		}
		let token = '_' + index;
		repl = repl.replace(token, history[arrIndex]);
		return repl;
	}

	let disposable = vscode.commands.registerCommand('extension.cscs-debug.repl', () => {
		let code = getCode();
		if (code === '') {
			return;
		}
		//vscode.window.showInformationMessage('REPL: ' + code);
		for (let i = 20; i > 0; i--) {
			code = replaceReplHistory(code, i);
		}
		for (let i = 20; i > 0; i--) {
			code = replaceReplHistory(code, -1*i);
		}
		init = false;
		CscsRuntime.sendRepl(code);
	});
	context.subscriptions.push(disposable);


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

		/*const extConfig       = vscode.workspace.getConfiguration('cscs');
		config['connectType'] = extConfig.get('connectType', 'sockets');
		config['serverPort']  = extConfig.get('serverPort', config['serverPort']);
		config['serverHost']  = '127.0.0.1';
		if (config.name.toLowerCase().indexOf("remote") >= 0)
		{
			config['serverHost']  = extConfig.get('serverHost', config['serverHost']);
			config['serverBase']  = extConfig.get('serverBase');
		}*/

		return config;
	}

	dispose() {
		if (this._server) {
			this._server.close();
		}
	}
}
