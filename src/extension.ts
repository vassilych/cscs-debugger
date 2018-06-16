/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import { CscsDebugSession } from './cscsDebug';
import * as Net from 'net';

const Path = require('path');

/*
 * Set the following compile time flag to true if the
 * debug adapter should run inside the extension host.
 * Please note: the test suite does no longer work in this mode.
 */
const EMBED_DEBUG_ADAPTER = false;

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(vscode.commands.registerCommand('extension.cscs-debug.getProgramName', config => {
		return vscode.window.showInputBox({
			placeHolder: "Enter the name of a CSCS file in the workspace folder",
			value: "test.cscs"
		});
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.cscs-debug2.getProgramName', config => {
		let filename = "";
		let fileData =
		vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false
			//defaultUri: vscode.Uri.file("test.cscs")
		}).then(fileObj => {
			let pathname = fileObj ? fileObj[0].toString() : '';
			let path = String(pathname);
			filename = Path.basename(path);
			console.warn('Filename chosen: ' + path + ' --> ' + filename);
		});

		return fileData;
	}));

	// register a configuration provider for 'cscs' debug type
	const provider = new CscsConfigurationProvider()
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('cscs', provider));
	context.subscriptions.push(provider);
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
