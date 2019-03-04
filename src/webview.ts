import * as path from 'path';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';


export class MainPanel  extends EventEmitter {

	public static currentPanel: MainPanel | undefined;

	public static readonly viewType = 'cscs.repl';

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionPath: string;
	private _disposables: vscode.Disposable[] = [];

	private _cmdHistory    = new Array<string>();

	private _historyLoaded = false;

	public static createOrShow(extensionPath: string) : MainPanel {
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

		MainPanel.currentPanel = new MainPanel(panel, extensionPath);
		return MainPanel.currentPanel;
	}

	public static revive(panel: vscode.WebviewPanel, extensionPath: string) {
		MainPanel.currentPanel = new MainPanel(panel, extensionPath);
	}

	public constructor(	panel: vscode.WebviewPanel, extensionPath: string) {
		super();
		this._panel = panel;
		this._extensionPath = extensionPath;

		this._update();

		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		this._panel.onDidChangeViewState(e => {
			if (this._panel.visible) {
				this._update()
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
				case 'save':
					this.saveFile();
					return;
				case 'load':
					this.loadFile();
					return;
				case 'show_history':
					this.showDialog();
					return;
				case 'repl':
					this.sendEvent('onRepl', message.text);
					/*if (this._cmdHistory.length > 0 &&
						this._cmdHistory[this._cmdHistory.length-1] === message.text) {
							return;
						}*/
					if (this._historyLoaded && this._cmdHistory.find(message.text) !== undefined) {
						return;
					}
					this._historyLoaded = false;
					this._cmdHistory.push(message.text)
					return;
			}
		}, null, this._disposables);
	}

	private showDialog() {
		let options: vscode.QuickPickOptions = {
			canPickMany: false,
			placeHolder: 'CSCS Command History'
		}

		vscode.window.showQuickPick(this._cmdHistory, options).then(value => {
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

					this._cmdHistory    = new Array<string>();
					let lines = msg.split('\n');
					for (let i = 0; i < lines.length; i++) {    
						let line = lines[i].trim();
						if (line === '') {
							continue;
						}
						this._cmdHistory.push(line);
					}
	
					this._panel.webview.postMessage({ command: 'load', text: msg, filename: pathname });
					this._historyLoaded = true;
				}
		});
	}
	private saveFile() {
		if (this._cmdHistory.length === 0) {
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

					for (let i = 0; i < this._cmdHistory.length; i++) {
						let line = this._cmdHistory[i] + '\n';
						fs.appendFileSync(pathname, line, function (err) {
							if (err) {
								throw err;
							}
							console.log('Saved!');
						  });
					}
		
					vscode.window.showInformationMessage('Saved file at ' + pathname);
				}
		});
	}

	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}

	public sendRepl(data: string) {
		this._panel.webview.postMessage({ command: 'repl_response', text: data });
		/*let lines = data.split('\\n');
		if (lines.length === 1) {
			lines = data.split('\n');
		}
		for (let i = 0; i < lines.length; i++) {
			let line = lines[i].trim();
			if (i === 0 && line.startsWith("repl")) {
				continue;
			}
			if (line === "" && i === lines.length - 1) {
				break;
			}
			this._panel.webview.postMessage({ command: 'repl', text: line });
		}*/
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

	private _update() {
		this._panel.title = "CSCS REPL";
		this._panel.webview.html = this._getHtmlForWebview();
	}

	private _getHtmlForWebview() {

		const scriptPathOnDisk = vscode.Uri.file(path.join(this._extensionPath, 'media', 'main.js'));
		const scriptUri = scriptPathOnDisk.with({ scheme: 'vscode-resource' });

		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce();

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
			<h3 id="header_name"><b><font color="yellow">CSCS REPL</font></b></h2>
			<h4 id="tips">
			<table border="0">
			<tr>
			    <td><font color="aqua"><span><b>&#8593;</b></span></font> Previous Command &nbsp; &nbsp;</td>
			    <td><font color="aqua"><span><b>&#8595;</b></span></font> Next Command &nbsp; &nbsp;</td>
			    <td><font color="aqua"><b>&lt;ESC&gt;</b></font> Clear Line &nbsp; &nbsp;</td>
			    <td><font color="aqua"><b>&lt;ENTER&gt;</b></font> Evaluate</td>
			</tr>
			<tr>
				<td><font color="aqua"><b>&#8984;L (&#8963;L)</b></font> Load Session &nbsp; &nbsp;</td>
				<td><font color="aqua"><b>&#8984;S (&#8963;S)</b></font> Save Session &nbsp; &nbsp;</td>
				<td><font color="aqua"><b>&#8984;X (&#8963;X)</b></font> Clear Screen &nbsp; &nbsp;</td>
				<td><font color="aqua"><b>&#8984;U (&#8963;U)</b></font> Run Loaded &nbsp; &nbsp;</td>
				<td><font color="aqua"><b>&#8984;H (&#8963;H)</b></font> History &nbsp; &nbsp;</td>
			</tr>
		   </table>
			</h4>
				<!--<input tag = "entry" id="entry" name="entry_field" size="80" type="text"
					onkeypress="return itemKeyDown(event)" />-->

				<input id="btnClear" type="button" value="Clear" />
				<input id="btnLoad" type="button" value="Load Session" />
				<input id="btnSave" type="button" value="Save Session" />
				<input id="btnRun"  type="button" value="Run Loaded"   />

                <br><br><hr>
				<textarea tag = "output" id="output" name="output_field" rows="40" cols="130">REPL> </textarea>
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
  

