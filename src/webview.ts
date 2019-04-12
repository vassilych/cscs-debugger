import * as path from 'path';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { CscsRuntime } from './cscsRuntime';


export class REPLSerializer implements vscode.WebviewPanelSerializer {
	static initRuntime: (cscsRuntime : CscsRuntime) => void;
	static getConnectionData: () => [string, string, number];
	static getActiveFilename: () => string;

	async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
		MainPanel.revive(webviewPanel, MainPanel.extensionPath);
		REPLSerializer.init();
	}

	public static init() {
		if (REPLSerializer.initRuntime !== undefined && MainPanel.currentPanel !== undefined) {
			MainPanel.currentPanel.on('onRepl', (code : string) => {
				if ( MainPanel.requestSent ||
					(MainPanel.currentPanel &&
					 MainPanel.globalId !== MainPanel.currentPanel.localId)) {
						return;
				}
				MainPanel.requestSent = true;
				let cscsRuntime   = CscsRuntime.getNewInstance(true);
				let [connectType, host, port] = REPLSerializer.getConnectionData();
				REPLSerializer.initRuntime(cscsRuntime);
				cscsRuntime.startRepl(connectType, host, port);
				MainPanel.init = false;
				
				try {
					//code = REPLSerializer.getActiveFilename() + "|" + code;
					let cmdSent = cscsRuntime.sendRepl(code);
					MainPanel.addHistory(cmdSent);
					if (cmdSent.length === 0 && MainPanel.currentPanel !== undefined) {
						MainPanel.currentPanel.sendReplResponse('');
					}
				} catch (err) {
					cscsRuntime.makeInvalid();
					if (MainPanel.currentPanel !== undefined) {
						MainPanel.currentPanel.sendReplResponse("Error: " + err);
					}
				}
			});
		}
	}
}

export class MainPanel  extends EventEmitter {

	public static currentPanel: MainPanel | undefined;
	public static readonly viewType = 'cscs.repl';
	public static extensionPath: string;
	public static status = '';
	public static init   = true;
	public static globalId = 1;
	public static requestSent = false;

	private static cmdHistory = new Array<string>();
	//private static historyLoaded = false;

	public localId = 1;
	private readonly _panel: vscode.WebviewPanel;
	private _disposables: vscode.Disposable[] = [];
	

	public static createOrShow(extensionPath: string) {
		MainPanel.setPath(extensionPath);
		const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

		if (MainPanel.currentPanel) {
			MainPanel.currentPanel._panel.reveal(column);
			return MainPanel.currentPanel;
		}

		const panel = vscode.window.createWebviewPanel(MainPanel.viewType, "CSCS REPL", column || vscode.ViewColumn.One, {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.file(path.join(extensionPath, 'media'))
			]
		});

		MainPanel.currentPanel = new MainPanel(panel);
		REPLSerializer.init();
		return MainPanel.currentPanel;
	}

	public static setPath(extensionPath: string) {
		if (extensionPath !== '') {
			MainPanel.extensionPath = extensionPath;
		}
	}

	public static revive(panel: vscode.WebviewPanel, extensionPath: string) {
		MainPanel.setPath(extensionPath);
		MainPanel.currentPanel = new MainPanel(panel);
		REPLSerializer.init();
	}

	public constructor(	panel: vscode.WebviewPanel) {
		super();
		this._panel = panel;

		this.update();

		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		console.info("WebView Extension Path: " + MainPanel.extensionPath);

		this._panel.onDidChangeViewState(e => {
			if (this._panel.visible) {
				this.update()
			}
		}, null, this._disposables);

		this._panel.webview.onDidReceiveMessage(message => {
			switch (message.command) {
				case 'info':
					vscode.window.showInformationMessage(message.text);
					return;
				case 'warning':
					vscode.window.showWarningMessage(message.text);
					return;
				case 'error':
					vscode.window.showErrorMessage(message.text);
					return;
				case 'get_clipboard':
					this.sendClipboard();
					return;
				case 'write_clipboard':
					this.copyToClipboard(message.text);
					return;
				case 'save':
					this.saveFile();
					return;
				case 'load':
					this.loadFile();
					return;
				case 'show_history':
					this.showDialog();
					return;
				case 'clear_history':
					MainPanel.cmdHistory.length = 0;
					return;
				case 'request_id':
					MainPanel.sendId();
					return;
				case 'request_history':
					MainPanel.sendHistory();
					return;
				case 'send_history':
					MainPanel.getHistory(message.history);
					return;
				case 'repl':
					if (MainPanel.globalId !== message.id) {
						return;
					}
					MainPanel.requestSent = false;
					this.sendEvent('onRepl', message.text);
					return;
			}
		}, null, this._disposables);
	}

	public static sendId() {
		if (MainPanel.currentPanel !== undefined) {
			MainPanel.currentPanel.localId = ++MainPanel.globalId;
			MainPanel.currentPanel._panel.webview.postMessage({ command: 'id', id: MainPanel.globalId });
		}
	}
	public static sendHistory() {
		if (MainPanel.currentPanel !== undefined && MainPanel.cmdHistory.length > 0) {
			MainPanel.currentPanel._panel.webview.postMessage({ command: 'history',
			 history: MainPanel.cmdHistory });
		}
	}
	public static getHistory(history : Array<string>) {
		if (MainPanel.currentPanel !== undefined) {
			MainPanel.cmdHistory = history;
		}
	}
	public static addHistory(commands : Array<string>) {
		for(let i = 0; i < commands.length; i++) {		
			this.addHistoryCommand(commands[i]);
		}
		if (MainPanel.currentPanel !== undefined) {
			MainPanel.currentPanel._panel.webview.postMessage({ command: 'history', history: this.cmdHistory });
		}
	}

	public static addHistoryCommand(cmd : string) {
		cmd = cmd.trim();
		if (cmd === '') {
			return;
		}
		if (this.cmdHistory.length > 0 &&
			this.cmdHistory[this.cmdHistory.length-1] === cmd) {
			return;
		}
		//if (this.historyLoaded && this.cmdHistory.indexOf(cmd) >= 0) {
		//	return;
		//}
		//this.historyLoaded = false;
		this.cmdHistory.push(cmd);
	}

	private showDialog() {
		let options: vscode.QuickPickOptions = {
			canPickMany: false,
			placeHolder: 'CSCS Command History'
		}

		vscode.window.showQuickPick(MainPanel.cmdHistory, options).then(value => {
			if (value !== undefined) {
				//vscode.window.showInformationMessage(value);
				this._panel.webview.postMessage({ command: 'request', text: value });
			}
		});
	}

	private loadFile() {
		const options: vscode.OpenDialogOptions = {
			openLabel: 'Open',
			filters: {
			   'REPL files': ['repl'],
			   'All files': ['*']
		   },
		   defaultUri: vscode.Uri.file('session.repl')
	   };
	
		vscode.window.showOpenDialog(options).then(
			(filenames: vscode.Uri[] | undefined) => {
				if (filenames !== undefined) {
					let filename = filenames[0];
					const fs = require('fs');

					let pathname = path.resolve(filename.fsPath);
					let data = fs.readFileSync(pathname, '');
					let msg = data.toString();

					MainPanel.cmdHistory.length = 0;
					let lines = msg.split('\n');
					for (let i = 0; i < lines.length; i++) {    
						let line = lines[i].trim();
						if (line === '') {
							continue;
						}
						MainPanel.cmdHistory.push(line);
					}
	
					this._panel.webview.postMessage({ command: 'load', text: msg, filename: pathname });
					//MainPanel.historyLoaded = true;
				}
		});
	}
	private saveFile() {
		if (MainPanel.cmdHistory.length === 0) {
			vscode.window.showErrorMessage('There is no history to save');
			return;
		}
		const options: vscode.SaveDialogOptions = {
			saveLabel: 'Save',
			filters: {
			   'REPL files': ['repl'],
			   'All files': ['*']
		   },
		   defaultUri: vscode.Uri.file('session.repl')
	   };
	
		vscode.window.showSaveDialog(options).then(
			(filename: vscode.Uri | undefined) => {
				if (filename !== undefined) {
					const fs = require('fs');


					let pathname = path.resolve(filename.fsPath);
					fs.writeFileSync(pathname, '');

					for (let i = 0; i < MainPanel.cmdHistory.length; i++) {
						let line = MainPanel.cmdHistory[i] + '\n';
						fs.appendFileSync(pathname, line, function (err) {
							if (err) {
								throw err;
							}
							console.log('Saved file ' + pathname);
						  });
					}
		
					vscode.window.showInformationMessage('Saved file ' + pathname);
				}
		});
	}

	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}

	public sendReplResponse(data: string) {
		this._panel.webview.postMessage({ command: 'repl_response', text: data });
	}

	sendClipboard() {
		vscode.env.clipboard.readText().then((text)=>{
			this._panel.webview.postMessage({ command: 'clipboard_content', text: text });
		})
	}

	copyToClipboard(text: string) {
		vscode.env.clipboard.writeText(text).then((text)=>{
			this._panel.webview.postMessage({ command: 'copy_completed', text: text });
		})
	}

	public dispose() {
		MainPanel.currentPanel = undefined;
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	public update() {
		this._panel.title = "CSCS REPL";
		this._panel.webview.html = MainPanel.getHtmlForWebview();
	}

	public static getHtmlForWebview() {

		const scriptPathOnDisk = vscode.Uri.file(path.join(MainPanel.extensionPath, 'media', 'main.js'));
		const scriptUri = scriptPathOnDisk.with({ scheme: 'vscode-resource' });

		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce();
		const connStatus = MainPanel.status;

		return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">

                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-resource: https:; script-src 'nonce-${nonce}';">

                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>CSCS REPL</title>
            </head>
            <body>
			<center>
			<h3 id="header_name"><b><font color="yellow">CSCS REPL</font></b></h3>
			<h4 id="tips">
			<table border="0">
			<tr>
				<td><font color="aqua"><b>ENTER</b></font> Evaluate</td>
				<td><font color="aqua"><b>SHIFT-ENTER</b></font> Eval Selected</td>
				<td><font color="aqua"><b>&#8984;-H (&#8963;H)</b></font> History &nbsp; &nbsp;</td>
				<td><font color="aqua"><b>&#8984;-M</b></font> Clear History &nbsp; &nbsp;</td>
			</tr>
			<tr>
			<td><font color="aqua"><span><b>&#8984;-K</b></span></font> Next Command &nbsp; &nbsp;</td>
			<td><font color="aqua"><span><b>&#8984;-I</b></span></font> Previous Command &nbsp; &nbsp;</td>
				<td><font color="aqua"><b>&lt;ESC&gt;</b></font> Clear Line &nbsp; &nbsp;</td>
				<td><font color="aqua"><b>&#8984;-D</b></font> Clear Screen &nbsp; &nbsp;</td>
			<!--<td><font color="aqua"><b>&#8984;L (&#8963;L)</b></font> Load Session &nbsp; &nbsp;</td>
				<td><font color="aqua"><b>&#8984;S (&#8963;S)</b></font> Save Session &nbsp; &nbsp;</td>
				<td><font color="aqua"><b>&#8984;U (&#8963;U)</b></font> Run Loaded &nbsp; &nbsp;</td>
			-->
			</tr>
		   </table>
			</h4>
				<!--<input tag = "entry" id="entry" name="entry_field" size="80" type="text"
					onkeypress="return itemKeyDown(event)" />-->

				<input id="btnClear"   type="button" value="Clear Screen" />
				<input id="btnLoad"    type="button" value="Load Session" />
				<input id="btnSave"    type="button" value="Save Session" />
				<input id="btnRun"     type="button" value="Run Loaded"   />
				<input id="btnHistory" type="button" value="History"   />
				<input id="btnCopy"    type="button" value="Copy"   />
				<input id="btnPaste"   type="button" value="Paste"   />
				<!--<div id='status' align='center' ><font color="green">${connStatus}</font></div>
				-->
                <hr>
				<textarea tag = "output" id="output" name="output_field" rows="36" cols="120">REPL> </textarea>
				<div id='display' align='left' style="overflow:auto;height:400px;">
				</div>

                </center>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
	}
}

function getNonce() {
	let text = "";
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
