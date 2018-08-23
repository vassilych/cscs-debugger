/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
//import { CscsRuntime } from './cscsRuntime';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import { CscsDebugSession } from './cscsDebug';
import * as Net from 'net';
import * as Path from 'path';
/*
 * Set the following compile time flag to true if the
 * debug adapter should run inside the extension host.
 * Please note: the test suite does no longer work in this mode.
 */
const EMBED_DEBUG_ADAPTER = false;

export function activate(context: vscode.ExtensionContext) {
	console.log('Extension "cscs-debug" is now active.');

	context.subscriptions.push(vscode.commands.registerCommand(
		'extension.cscs-debug.getProgramName', config => {
			let textEditor = vscode.window.activeTextEditor;
			if (textEditor && textEditor.document && textEditor.document.fileName) {
				let filename  = Path.parse(textEditor.document.fileName).base;
				return filename;
			}
			return vscode.window.showInputBox({
				placeHolder: "Enter the name of a CSCS file in the workspace folder",
				value: "test.cscs"
		});
	}));

	// register a configuration provider for 'cscs' debug type
	const provider = new CscsConfigurationProvider()
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('cscs', provider));
	context.subscriptions.push(provider);

	//let outputChannel = vscode.window.createOutputChannel('CSCS');
    /*const getCode = () => {
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
        return text;
    };

    let disposable = vscode.commands.registerCommand('debugger.cscs.repl', () => {
        let code = getCode();
        if (code === '') {
            return;
        }
        CscsRuntime.sendRepl(code);
    });
    context.subscriptions.push(disposable);*/
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

		if (EMBED_DEBUG_ADAPTER) {
			// start port listener on launch of first debug session
			if (!this._server) {

				// start listening on a random port
				this._server = Net.createServer(socket => {
					const session = new CscsDebugSession();
					session.setRunAsServer(true);
					session.start(<NodeJS.ReadableStream>socket, socket);
				}).listen(0);
			}

			// make VS Code connect to debug server instead of launching debug adapter
			config.debugServer = this._server.address().port;
		}

		return config;
	}

	dispose() {
		if (this._server) {
			this._server.close();
		}
	}
}
