/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import * as Net from 'net';
import * as Path from 'path';

export function activate(context: vscode.ExtensionContext) {

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
	context.subscriptions.push(vscode.commands.registerCommand(
		'extension.cscs-debug.runLocal', config => {
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
	context.subscriptions.push(vscode.commands.registerCommand(
		'extension.cscs-debug.runRemote', config => {
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

		const extConfig       = vscode.workspace.getConfiguration('cscs');
		config['connectType'] = extConfig.get('connectType', 'sockets');
		config['serverPort']  = extConfig.get('serverPort', config['serverPort']);
		config['serverHost']  = '127.0.0.1';
		if (config.name.toLowerCase().indexOf("remote") >= 0)
		{
			config['serverHost']  = extConfig.get('serverHost', config['serverHost']);
			config['serverBase']  = extConfig.get('serverBase');
		}

		return config;
	}

	dispose() {
		if (this._server) {
			this._server.close();
		}
	}
}
