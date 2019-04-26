/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';

import { readFileSync } from 'fs';
import { EventEmitter } from 'events';
import { DebugProtocol } from 'vscode-debugprotocol';

//import { CscsDebugSession } from './cscsDebug';
//import * as vscode from 'vscode';
//import { OutputChannel, window } from 'vscode';

const Net  = require("net");
const Path = require('path');
const fs   = require('fs');

export interface CscsBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}
export interface StackEntry {
	id: number;
	line: number;
	name: string;
	file: string;
}

export abstract class Data {
    static id = 0;

    public static sameInstance(instanceId : number): boolean {
      return Data.id === instanceId;
    }
    public static getId(): number {
		return Data.id;
	  }
	  public static getNextId(): number {
		return ++Data.id;
	  }
  }

export class CscsRuntime extends EventEmitter {

	private static _instance: CscsRuntime;
	private static _firstRun = true;

	private _instanceId  = 0;
	private _debugger    = new Net.Socket();
	private _connectType = 'sockets';
	private _host        = '127.0.0.1';
	private _port        = 13337;
	private _serverBase  = '';
	private _localBase   = '';

	private _localVariables = new Array<DebugProtocol.Variable>();
	public get localVariables() {
		return this._localVariables;
	}
	private _globalVariables = new Array<DebugProtocol.Variable>();
	public get globalVariables() {
		return this._globalVariables;
	}

	private _variablesMap = new Map<string, string>();
	private _hoversMap    = new Map<string, string>();
	private _functionsMap = new Map<string, string>();
	private _filenamesMap = new Map<string, string>();

	private _connected    = false;
	private _init         = true;
	private _continue     = false;
	private _isException  = false;
	private _replInstance = false;
	private _isValid      = true;

	private _gettingFile  = false;
	private _fileTotal    = 0;
	private _fileReceived = 0;
	private _dataFile     = '';
	private _fileBytes    : Buffer;

	private _gettingData  = false;
	private _dataTotal    = 0;
	private _dataReceived = 0;
	private _dataBytes    : Buffer;

	private _lastReplSource = '';

	private _queuedCommands = new Array<string>();

	//private _outputChannel : OutputChannel;
	//private _debugSession : CscsDebugSession;

	// the initial (and one and only) file we are 'debugging'
	private _sourceFile = '';
	public get sourceFile() {
		return this._sourceFile;
	}

	// the contents (= lines) of the one and only file
	private _sourceLines: string[];

	// This is the next line that will be 'executed'
	private _originalLine = 0;

	private _stackTrace      = new Array<StackEntry>();

	// maps from sourceFile to array of Cscs breakpoints
	private _breakPoints     = new Map<string, CscsBreakpoint[]>();
	private _breakPointMap   = new Map<string, Map<number, CscsBreakpoint>>();

	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private _breakpointId    = 1;

	private constructor(isRepl = false) {
		super();
		this._replInstance = isRepl;
		this._instanceId = Data.getNextId();
		this.initFunctionNames();
	}

	public static getNewInstance(isRepl = false): CscsRuntime {		
		return new CscsRuntime(isRepl);
	}
	public static getInstance(reload = false): CscsRuntime {
		let cscs = CscsRuntime._instance;
		if (cscs === null || reload ||
		   (!cscs._connected && !cscs._init) ||
		    !Data.sameInstance(cscs._instanceId)) {
				CscsRuntime._instance = new CscsRuntime(false);
		}
		return CscsRuntime._instance;
	}

	public startRepl(connectType: string, host: string, port: number) {
		if (this._connected) {
			return;
		}
		this._connectType = connectType;
		this._host = host;
		this._port = port;

		this.connectToDebugger();
	}

	public start(program: string, stopOnEntry: boolean, connectType: string,
		           host: string, port: number, serverBase = "") {

		this._connectType = connectType;
		this._host = host;
		this._port = port;
		this._serverBase = serverBase;

		if (host === "127.0.0.1") {
			this._serverBase = "";
		}

		this.loadSource(program);
		this._originalLine = this.getFirstLine();

		this.verifyBreakpoints(this._sourceFile);

		this.connectToDebugger();

		if (stopOnEntry) {
			// we step once
			this.step('stopOnEntry');
		} else {
			// we just start to run until we hit a breakpoint or an exception
			this.continue();
		}
		//this.printCSCSOutput('StartDebug ' + host + ":" + port + "(" + this._instanceId + ")");
	}

	static throwErrorMsg(repl: string, level: number, lineStart: number, lineEnd: number,
		                    msg: string) : string
	{
		let lines = repl.split('\n');

		if (lines.length <= 1) {
			throw msg;
		}

		let lineNumber = level > 0 ? lineStart : lineEnd;
		let currentLineNumber = lineNumber;
		let line = lines[lineNumber].trim();
		let collectMore = line.length < 3;
		let lineContents = line;

		while (collectMore && currentLineNumber > 0) {
			line = lines[--currentLineNumber].trim();
			collectMore = line.length < 2;
			lineContents = line + "  " + lineContents;
		}

		let lineStr = currentLineNumber === lineNumber ? "Line " + (lineNumber+1) :
		                  "Lines " + (currentLineNumber+1) + "-" + (lineNumber+1);

		throw msg + " " + lineStr + ": " + lineContents;
	}

	splitREPL(repl: string) : [string, Array<string>]
	{
		let curlyErrorMsg   = "Unbalanced curly braces.";
		let bracketErrorMsg = "Unbalanced square brackets.";
		let parenthErrorMsg = "Unbalanced parentheses.";
		let quoteErrorMsg   = "Unbalanced quotes.";

		let cmd      = '';
		let commands = new Array<string>();
		let current  = '';
		let inCurly  = false;
		let levelCurly       = 0;
		let levelBrackets    = 0;
		let levelParentheses = 0;
		let inComments       = false;
		let simpleComments   = false;
		let inQuotes         = false;
		let inQuotes1        = false;
		let inQuotes2        = false;
		let prev             = '';
		let prevprev         = '';
		let lineNumber       = 0;
		let lineNumberCurly  = 0;
		let lineNumberBrack  = 0;
		let lineNumberPar    = 0;
		let lineNumberQuote  = 0;

		for (let i = 0; i < repl.length; i++) {
			let ch = repl[i];
			let next = i < repl.length - 1 ? repl[i+1] : '';

			if (ch === '\r') {
				continue;
			}
			if (ch === '\n') {
				if (simpleComments) {
					inComments = simpleComments = false;
				}
				cmd       += '\r';
				lineNumber++;
				continue;
			}
			if (!inQuotes && ch === ' ' && current.endsWith(' ')) {
				continue;
			}

			if (inComments && ((simpleComments && ch !== '\n') ||
				(!simpleComments && ch !== '*'))) {
				continue;
			}
			let completed = ch === ';' && !inCurly && !inQuotes && !inComments;

			switch (ch) {
				case '/':
					if (!inQuotes && (inComments || next === '/' || next === '*')) {
							inComments = true;
							simpleComments = simpleComments || next === '/';
							continue;
					}
					break;
				case '*':
					if (!inQuotes && (inComments && next === '/')) {
						i++; // skip next character
						inComments = false;
						continue;
					}
					break;
				case "'":
					if (!inComments && !inQuotes2 && (prev !== '\\' || prevprev === '\\'))	{
						inQuotes = inQuotes1 = !inQuotes1;
						if (inQuotes) {
							lineNumberQuote = lineNumber;
						}
					}
					break;
				case '"':
					if (!inComments && !inQuotes1 && (prev !== '\\' || prevprev === '\\'))	{
						inQuotes = inQuotes2 = !inQuotes2;
						if (inQuotes) {
							lineNumberQuote = lineNumber;
						}
					}
					break;
				case '{':
					if (!inQuotes && !inComments) {
						inCurly = true;
						levelCurly++;
						lineNumberCurly = lineNumber;
					}
					break;
				case '}':
					if (!inQuotes && !inComments) {
						levelCurly--;
						if (levelCurly < 0) {
							CscsRuntime.throwErrorMsg(repl, levelCurly, lineNumberCurly, lineNumber, curlyErrorMsg);
						}
						inCurly = levelCurly > 0;
						completed = !inCurly && levelParentheses === 0 && levelBrackets === 0;
					}
					break;
				case '[':
					if (!inQuotes && !inComments) {
						levelBrackets++;
						lineNumberBrack = lineNumber;
					}
					break;
				case ']':
					if (!inQuotes && !inComments) {
						levelBrackets--;
						if (levelBrackets < 0) {
							CscsRuntime.throwErrorMsg(repl, levelBrackets, lineNumberBrack, lineNumber, bracketErrorMsg);
						}
					}
					break;
				case '(':
					if (!inQuotes && !inComments) {
						levelParentheses++;
						lineNumberPar = lineNumber;
					}
					break;
				case ')':
					if (!inQuotes && !inComments) {
						levelParentheses--;
						if (levelParentheses < 0) {
							CscsRuntime.throwErrorMsg(repl, levelParentheses, lineNumberPar, lineNumber, parenthErrorMsg);
						}
					}
					break;
			}

			if (!inComments && ch !== '\n') {
				cmd     += ch;
				current += ch;
			}
			prevprev = prev;
			prev = ch;

			if (completed) {
				//current = current.replace(/\n/g, ' ').replace(/\r/g, ' ').trim();
				if (current !== '') {
					commands.push(current);
					current = '';
				}
			}
		}

		//current = current.replace(/\n/g, ' ').replace(/\r/g, ' ').trim();
		if (current !== '') {
			commands.push(current);
		}

		let error = levelCurly !== 0 || levelBrackets !== 0 ||
		            levelParentheses !== 0 || inQuotes;
		if (error) {
			if (inQuotes) {
				CscsRuntime.throwErrorMsg(repl, 1, lineNumberQuote, lineNumber, quoteErrorMsg);
			} else if (levelBrackets !== 0) {
				CscsRuntime.throwErrorMsg(repl, levelBrackets, lineNumberBrack, lineNumber, bracketErrorMsg);
			} else if (levelParentheses !== 0) {
				CscsRuntime.throwErrorMsg(repl, levelParentheses, lineNumberPar, lineNumber, parenthErrorMsg);
			} else if (levelCurly !== 0) {
				CscsRuntime.throwErrorMsg(repl, levelCurly, lineNumberCurly, lineNumber, curlyErrorMsg);
			}
	}

		return [cmd, commands];
	}

	public sendRepl(repl: string, filename = '') : Array<string>
	{
		this._lastReplSource = filename;
		let result = this.splitREPL(repl);
		let cmd = result[0];
		let commands =result[1];

		if (cmd !== '') {
			filename = filename.trim();
			if (filename !== '') {
				cmd = filename + "|" + cmd;
			}
			this.sendToServer('repl', cmd);
		}

		return commands;
	}

	public lastReplSource() : string {
		return this._lastReplSource;
	}
	
	public connectToDebugger() : void {
		if (this._connected) {
			return;
		}

		if (this._connectType === "sockets") {
			this.printCSCSOutput('Connecting to ' + this._host + ":" + this._port + '...', '', -1, ''); // no new line
			//console.log('Connecting to ' + this._host + ":" + this._port + '...');

			let timeout  = this._host === '127.0.0.1' || this._host === 'localhost' || this._host === '' ? 3.5 : 10;
			this._debugger.setTimeout(timeout * 1000);

			this._debugger.connect(this._port, this._host, () => {
				this._connected = true;
				this.printCSCSOutput('Connected to the Debugger Server.');
				//console.log('Connected to ' + this._host + ":" + this._port + '...');

				if (CscsRuntime._firstRun) {
				  this.printInfoMsg('CSCS: Connected to ' + this._host + ":" + this._port +
					'. Check Output CSCS Window for REPL and Debug Console for Debugger Messages');
				}
				this.sendEvent('onStatusChange', 'CSCS: Connected to ' + this._host + ":" + this._port);
				CscsRuntime._firstRun = false;
				this._init = false;

				if (!this._replInstance && this._sourceFile !== '') {
					let serverFilename = this.getServerPath(this._sourceFile);
					if (serverFilename !== undefined && serverFilename !== '') {
						//console.log('Sending serverFilename: [' + serverFilename + ']');
						this.sendToServer("file", serverFilename);
					}
					this.sendAllBreakpontsToServer();
				}

				for (let i = 0; i < this._queuedCommands.length; i++) {
					//console.log('Sending queued: ' + this._queuedCommands[i]);
					this.sendToServer(this._queuedCommands[i]);
				}
				this._queuedCommands.length = 0;
			});

			this._debugger.on('data', (data) => {
				if (!this._gettingData) {
					let ind = data.toString().indexOf('\n');
					this._dataTotal = this._dataReceived = 0;
					if (ind > 0) {
						this._dataTotal = Number(data.slice(0, ind));
						//this.printCSCSOutput('  Received data size: ' + this._dataTotal);
						if (isNaN(this._dataTotal)) {
							this._dataTotal = 0;
						}
					}
					if (this._dataTotal === 0) {
						this.processFromDebugger(data);
						return;
					}
					if (data.length > ind + 1) {
						data = data.slice(ind + 1);
					} else {
						data = '';
					}
					this._gettingData = true;
					//this.printCSCSOutput('  Started collecting data: ' + data.toString().substring(0,4));
				}
				if (this._gettingData) {
					if (this._dataReceived === 0) {
						this._dataBytes = data;
						this._dataReceived = data.length;
					} else {
					  //this.printCSCSOutput('  EXTRA. Currently: ' + this._dataReceived +
					  // ', total: ' + this._dataTotal + ', new: ' + data.length);
						const totalLength = this._dataBytes.length + data.length;
						this._dataBytes = Buffer.concat([this._dataBytes, data], totalLength);
						this._dataReceived = totalLength;
					}
					if (this._dataReceived >= this._dataTotal) {
						this._dataTotal = this._dataReceived = 0;
						this._gettingData = false;
						//this.printCSCSOutput('  COLLECTED: ' + this._dataBytes.toString().substring(0, 4) + "...");
						this.processFromDebugger(this._dataBytes);
					}
				}
			});

			this._debugger.on('timeout', () => {
				if (!this._connected) {
					this.printCSCSOutput("Timeout connecting to " + this._host + ":" + this._port);
					//this.printErrorMsg('Timeout connecting to ' + this._host + ":" + this._port);
					//console.log('Timeout connecting to ' + this._host + ":" + this._port + '...');
					this._debugger.destroy();
				}
  		});

			this._debugger.on('close', () => {
				if (this._init) {
					this.printCSCSOutput('Could not connect to ' + this._host + ":" + this._port);
					this.printErrorMsg('Could not connect to ' + this._host + ":" + this._port);
					this.sendEvent('onStatusChange', "CSCS: Couldn't connect to " + this._host + ":" + this._port);
				}
				//console.log('Closed connection to ' + this._host + ":" + this._port + '...');
				this._connected = false;
			});
		}
	}
	public sendToServer(cmd : string, data = "") {
		/*if (isRepl && this._sourceFile != '') {
			let msg = 'Cannot execute REPL while debugging.';
			this.printWarningMsg(msg);
			return;
		}*/

		let toSend = cmd;
		if (data !== '' || cmd.indexOf('|') < 0) {
			toSend += '|' + data;
		}
		if (!this._connected) {
			//console.log('Connection not valid. Queueing [' + toSend + '] when connected.');
			this._queuedCommands.push(toSend);
			return;
		}

		//this._replSent = isRepl;
		this._debugger.write(toSend + "\n");
	}
	public printDebugMsg(msg : string) {
		//console.info('    _' + msg);
	}
	public printCSCSOutput(msg : string, file = "", line = -1, newLine = '\n') {
		//console.error('CSCS> ' + msg + ' \r\n');
		//console.error();
		file = file === "" ?  this._sourceFile : file;
		file = this.getLocalPath(file);
		line = line >= 0 ? line : this._originalLine >= 0 ? this._originalLine : this._sourceFile.length - 1;
		//this.printDebugMsg("PRINT " + msg + " " + file + " " + line);
		this.sendEvent('output', msg, file, line, 0, newLine);
	}
	public printInfoMsg(msg : string) {
		this.sendEvent('onInfoMessage', msg);
	}
	public printWarningMsg(msg : string) {
		this.sendEvent('onWarningMessage', msg);
	}
	public printErrorMsg(msg : string) {
		this.sendEvent('onErrorMessage', msg);
	}

	protected processFromDebugger(data : any) {
		if (!this.isValid()) {
			return;
		}
		let lines = data.toString().split('\n');
		let currLine = 0;
		let response = lines[currLine++].trim();
		let startVarsData  = 1;
		let startStackData = 1;

		if (response === 'repl' || response === '_repl') {
			if (response === '_repl') {
				for (let i = 1; i < lines.length - 1; i++) {
					let line = lines[i].trim();
					if (line !== '') {
						this.printCSCSOutput(lines[i]);
					}
				}
			}
			if (response === 'repl' && this._replInstance) {
				this.sendEvent('onReplMessage', data.toString());
				this.disconnectFromDebugger();
			}
			return;
		}
		if (response === 'send_file' && lines.length > 2) {
			this._gettingFile  = true;
			this._fileTotal    = Number(lines[currLine++]);
			this._dataFile     = lines[currLine++];
			this._fileReceived = 0;
			if (lines.length <= currLine + 1) {
				return;
			}
			let ind = data.toString().indexOf(this._dataFile);
			if (ind > 0 && data.length > ind + this._dataFile.length + 1) {
				data = data.slice(ind + this._dataFile.length + 1);
				//this._fileBytes = data;
				//this._fileReceived = this._fileBytes.length;
			}
		}
		if (this._gettingFile) {
			if (this._fileReceived === 0) {
				this._fileBytes = data;
				this._fileReceived = this._fileBytes.length;
			} else if (response !== 'send_file') {
				const totalLength = this._fileBytes.length + data.length;
				this._fileBytes = Buffer.concat([this._fileBytes, data], totalLength);
				this._fileReceived = totalLength;
			}
			if (this._fileReceived >= this._fileTotal) {
				let buffer = Buffer.from(this._fileBytes);
				fs.writeFileSync(this._dataFile, buffer, (err) => {
					if (err) {
						throw err;
					}
				});
				this._fileTotal = this._fileReceived = 0;
				this._gettingFile = false;
				this.printCSCSOutput('Saved remote file to: ' + this._dataFile);
				if (this._replInstance) {
					this.sendEvent('onReplMessage', 'Saved remote file to: ' + this._dataFile);
				}
			}
			return;
		}

		if (response === 'end') {
			this.disconnectFromDebugger();
			return;
		}
		if (response === 'vars' || response === 'next' || response === 'exc') {
			this._localVariables.length  = 0;
			this._globalVariables.length = 0;
		}
		if (response === 'exc') {
			this.sendEvent('stopOnException');
			this._isException = true;
			startVarsData = 2;
			let nbVarsLines  = Number(lines[startVarsData]);
			this.fillVars(lines, startVarsData, nbVarsLines);

			startStackData = startVarsData + nbVarsLines + 1;
			this.fillStackTrace(lines, startStackData);

			let msg  = lines.length < 2 ? '' : lines[1];
			let headerMsg = 'Exception thrown. ' + msg + ' ';
			if (this._stackTrace.length < 1) {
				this.printCSCSOutput(headerMsg);
			} else {
				let entry = this._stackTrace[0];
				this.printCSCSOutput(headerMsg, entry.file, entry.line);
			}
			return;
		}
		if (response === 'next' && lines.length > 3) {
			let filename  = this.getLocalPath(lines[currLine++]);
			this.loadSource(filename);
			this._originalLine = Number(lines[currLine++]);
			let nbOutputLines  = Number(lines[currLine++]);

			for (let i = 0; i < nbOutputLines && currLine < lines.length - 1; i += 2) {
				let line = lines[currLine++].trim();
				if (i === nbOutputLines - 1) {
					break;
				}
				let parts = line.split('\t');
				let linenr = Number(parts[0]);
				let filename = parts.length < 2 ? this._sourceFile : parts[1];
				line = lines[currLine++].trim();

				if (i >= nbOutputLines - 2 && line === '') {
					break;
				}
				this.printCSCSOutput(line, filename, linenr);
			}

			startVarsData = currLine;
			this._globalVariables.push({
				name: '__line',
				type: 'number',
				value: String(this._originalLine + 1).trimRight(),
				variablesReference: 0
			});
			if (this._originalLine >= 0) {
				if (this._continue) {
					let bp = this.getBreakPoint(this._originalLine);
					this.printDebugMsg('breakpoint on ' + this._originalLine + ': ' + (bp!==undefined));
					if (bp) {
						this.runOnce('stopOnStep');
					} else {
						this.sendToServer('continue');
					}
				} else {
					this.runOnce('stopOnStep');
				}
			}
		}
		if (response === 'vars' || response === 'next') {
			let nbVarsLines  = Number(lines[startVarsData]);
			this.fillVars(lines, startVarsData, nbVarsLines);
			startStackData = startVarsData + nbVarsLines + 1;
		}
		if (response === 'stack' || response === 'next') {
			this.fillStackTrace(lines, startStackData);
		}
		if (this._originalLine === -3) {
			this.disconnectFromDebugger();
			return;
		}
		if (response !== 'stack' && response !== 'next' && response !== 'file') {
			this.printCSCSOutput('GOT ' + response + ": " + lines.length + " lines." +
			                     ' LAST: ' + lines[lines.length - 2] + " : " + lines[lines.length - 1]);
		}
	}

	fillVars(lines : string[], startVarsData : number, nbVarsLines : number)  {
		let counter = 0;
		for (let i = startVarsData + 1; i < lines.length && counter < nbVarsLines; i++) {
			counter++;
			let line = lines[i];
			let tokens  = line.split(':');
			if (tokens.length < 4) {
				continue;
			}
			let name    = tokens[0];
			let globLoc = tokens[1];
			let type    = tokens[2];
			let value   = tokens.slice(3).join(':').trimRight();
			if (type === 'string') {
				value = '"' + value + '"';
			}
			let item = {
				name: name,
				type: type,
				value: value,
				variablesReference: 0
			}
			if (globLoc === '1') {
				this._globalVariables.push(item);
			} else {
				this._localVariables.push(item);
			}
			let lower = name.toLowerCase();
			this._hoversMap.set(lower, value);
			this._variablesMap.set(lower, value);
		}
	}
	
	public makeInvalid() {
		this._isValid = false;
	}
	public isValid() : boolean {
		return this._isValid;
	}

	disconnectFromDebugger() {
		if (!this.isValid()) {
			return;
		}
		this.printCSCSOutput('Finished debugging.');
		this.sendToServer('bye');
		this._connected = false;
		this._sourceFile = '';
		this._debugger.end();
		this.sendEvent('end');
		this.makeInvalid();
		Data.getNextId();
		CscsRuntime._instance = CscsRuntime.getInstance(true);
	}

	fillStackTrace(lines : string[], start = 0) : void {
		let id = 0;
		this._stackTrace.length = 0;
		for (let i = start; i < lines.length; i += 3) {
			if (i >= lines.length - 2) {
				break;
			}
			let ln    = Number(lines[i]);
			let file  = this.getLocalPath(lines[i + 1].trim());
			let line  = lines[i + 2].trim();

			const entry = <StackEntry> { id: ++id, line : ln, name : line, file: file };
			this._stackTrace.push(entry);

			//this.printDebugMsg(file + ', line ' + ln + ':\t' + line);
		}
	}

	public getVariableValue(key : string) : string {
		let lower = key.toLowerCase();
		let val = this._variablesMap.get(lower);
		if (val) {
			return val;
		}
		return "--- unknown ---";
	}
	public getHoverValue(key : string) : string {
		let lower = key.toLowerCase();
		let hover = this._hoversMap.get(lower);
		if (hover) {
			return key + "=" + hover;
		}
		hover = this._functionsMap.get(lower);
		if (hover) {
			return hover;
		}
		let ind = lower.toString().indexOf('.');
		if (ind >= 0 && ind < lower.length - 1) {
			hover = this._functionsMap.get(lower.substring(ind + 1));
			if (hover) {
				return hover;
			}
		}
	
		return key;
	}
	/**
	 * Continue execution to the end/beginning.
	 */
	public continue() {
		if (!this.verifyDebug(this._sourceFile)) {
			return;
		}
		this._continue = true;
		this.sendToServer('continue');
	}

	public step(event = 'stopOnStep') {
		if (!this.verifyDebug(this._sourceFile)) {
			return;
		}
		this._continue = false;
		if (this._init) {
			this.runOnce(event);
		} else {
			this.sendToServer('next');
		}
	}
	public stepIn(event = 'stopOnStep') {
		if (!this.verifyDebug(this._sourceFile)) {
			return;
		}
		this._continue = false;
		this.sendToServer('stepin');
	}
	public stepOut(event = 'stopOnStep') {
		if (!this.verifyDebug(this._sourceFile)) {
			return;
		}
		this._continue = false;
		this.sendToServer('stepout');
	}

	private verifyException() : boolean {
		if (this._isException) {
			this.disconnectFromDebugger();
			return false;
		}
		return true;
	}
	public verifyDebug(file: string) : boolean {
		return this.verifyException() && file !== null &&
		  typeof file !== 'undefined' &&
		 (file.endsWith('cs') ||
		  file.endsWith('mqs'));
	}

	public stack(startFrame: number, endFrame: number): any {
		//this.printDebugMsg('stackTraceRequest ' + startFrame + ' ' + endFrame);
		const frames = new Array<any>();
		for (let i = 0; i < this._stackTrace.length; i ++) {
			let entry = this._stackTrace[i];
			frames.push({
				index: entry.id,
				name:  entry.name,
				file:  entry.file,
				line:  entry.line
			});
		}
		if (frames.length === 0) {
			let name = "";
			if (this._sourceLines.length > this._originalLine &&
				this._sourceLines[this._originalLine]) {
					name = this._sourceLines[this._originalLine].trim()
				}
			frames.push({
				index: 1,
				name:  name,
				file:  this._sourceFile,
				line:  this._originalLine
			});
		}
		return {
			frames: frames,
			count: this._stackTrace.length
		};
	}

	public sendBreakpontsToServer(path : string) {
		if (!this._connected) {
			return;
		}

		let filename = this.getActualFilename(path);
		path = Path.resolve(path);
		let lower = path.toLowerCase();

		let data = filename;
		let bps = this._breakPoints.get(lower) || [];

		for (let i = 0; i < bps.length; i ++) {
			let entry = bps[i].line;
			data += "|" + entry;
		}
		this.sendToServer('setbp', data);
	}

	replace(str: string, search: string, replacement: string)
	{
		str = str.split(search).join(replacement);
		return str;
	}

	getServerPath(pathname: string)
	{
		if (this._serverBase === "") {
			return pathname;
		}

		pathname = pathname.normalize();
		this.setLocalBasePath(pathname);

		let filename = Path.basename(pathname);
		let serverPath = Path.join(this._serverBase, filename);
		serverPath = this.replace(serverPath, "\\", "/");
		return serverPath;
	}

	setLocalBasePath(pathname: string)
	{
		if (this._localBase !== undefined && this._localBase !== null && this._localBase !== '') {
			return;
		}
		if (pathname === undefined || pathname === null ) {
			this._localBase = '';
			return;
		}
		pathname = Path.resolve(pathname);
		this._localBase = Path.dirname(pathname);
	}

	getLocalPath(pathname: string)
	{
		if (pathname === undefined || pathname === null || pathname === "") {
			return '';
		}
		if (this._serverBase === "") {
			return pathname;
		}

		pathname = pathname.normalize();
		pathname = this.replace(pathname, "\\", "/");
		let filename = Path.basename(pathname);
		this.setLocalBasePath(pathname);

		let localPath = Path.join(this._localBase, filename);
		return localPath;
	}

	sendAllBreakpontsToServer() {
		let keys = Array.from(this._breakPoints.keys() );
		for (let i = 0; i < keys.length; i ++) {
			let path = keys[i];
			this.sendBreakpontsToServer(path);
		}
	}

	public setBreakPoint(path: string, line: number) : CscsBreakpoint {
		//path = Path.normalize(path);
		path = Path.resolve(path);
		this.cacheFilename(path);

		let lower = path.toLowerCase();

		const bp = <CscsBreakpoint> { verified: false, line, id: this._breakpointId++ };
		let bps = this._breakPoints.get(lower);
		if (!bps) {
			bps = new Array<CscsBreakpoint>();
			this._breakPoints.set(lower, bps);
		}
		bps.push(bp);

		let bpMap = this._breakPointMap.get(lower);
		if (!bpMap) {
			bpMap = new Map<number, CscsBreakpoint>();
		}
		bpMap.set(line, bp);
		this._breakPointMap.set(lower, bpMap);
		if (lower.includes('functions.cscs')) {
			this.printDebugMsg("Verifying " + path);
		}

		this.verifyBreakpoints(path);

		return bp;
	}

	cacheFilename(filename: string) {
		filename = Path.resolve(filename);
		let lower = filename.toLowerCase();
		if (lower === filename) {
			return;
		}
		this._filenamesMap.set(lower, filename);
	}
	getActualFilename(filename: string): string {
		//filename = Path.normalize(filename);
		let pathname = Path.resolve(filename);
		let lower = pathname.toLowerCase();
		let result = this._filenamesMap.get(lower);
		if (result === undefined || result === null) {
			return filename;
		}
		return result;
	}
	private getBreakPoint(line: number) : CscsBreakpoint  | undefined {
		let pathname = Path.resolve(this._sourceFile);
		let lower = pathname.toLowerCase();
		let bpMap = this._breakPointMap.get(lower);
		if (!bpMap) {
			return undefined;
		}
		let bp = bpMap.get(line);
		return bp;
	}

	public clearBreakPoint(path: string, line: number) : CscsBreakpoint | undefined {
		let pathname = Path.resolve(path);
		let lower = pathname.toLowerCase();
		let bpMap = this._breakPointMap.get(lower);
		if (bpMap) {
			bpMap.delete(line);
		}

		let bps = this._breakPoints.get(lower);
		if (bps) {
			const index = bps.findIndex(bp => bp.line === line);
			if (index >= 0) {
				const bp = bps[index];
				bps.splice(index, 1);
				return bp;
			}
		}
		return undefined;
	}

	public clearBreakpoints(path: string): void {
		let pathname = Path.resolve(path);
		let lower = pathname.toLowerCase();
		this._breakPoints.delete(lower);
		this._breakPointMap.delete(lower);
	}

	private loadSource(filename: string) {
		if (filename === null || filename === undefined) {
			return;
		}
		filename = Path.resolve(filename);
		if (this._sourceFile !== null && this._sourceFile !== undefined &&
			  this._sourceFile.toLowerCase() === filename.toLowerCase()) {
			return;
		}
		if (this.verifyDebug(filename)) {
			this.cacheFilename(filename);
			this._sourceFile =  filename;
			this._sourceLines = readFileSync(this._sourceFile).toString().split('\n');
		}
	}

	private getFirstLine() : number {
		let firstLine = 0;
		if (this._sourceLines === null || this._sourceLines.length <= 1) {
			return 0;
		}
		let inComments = false;
		for (let i = 0; i < this._sourceLines.length; i++) {
			let line = this._sourceLines[i].trim();
			if (line === '') {
				continue;
			}
			firstLine = i;

			if (inComments) {
				let index = line.indexOf('*/');
				if (index >= 0) {
					if (index < line.length - 2) {
						break;
					}
					inComments = false;					 
				}
				continue;
			}

			if (line.startsWith('/*')) {
				inComments = true;
				i--;
				continue;
			}
			if (!line.startsWith('//')) {
				break;
			}
		}
		return firstLine;
	}

	private runOnce(stepEvent?: string) {
		this.fireEventsForLine(this._originalLine, stepEvent);
	}

	private verifyBreakpoints(path: string) : void {
		if (!this.verifyDebug(path)) {
			return;
		}

		path = Path.resolve(path);
		let lower = path.toLowerCase();

		let bpsMap = this._breakPointMap.get(lower);
		//this.printDebugMsg("Verifying " + path);
		let sourceLines = this._sourceLines;
		if (sourceLines === null) {
			this.loadSource(path);
			//sourceLines = readFileSync(path).toString().split('\n');
			sourceLines = this._sourceLines;
		}
		if (bpsMap && bpsMap.size > 0 && sourceLines) {
			bpsMap.forEach(bp => {
				if (!bp.verified && bp.line < sourceLines.length) {
					const srcLine = sourceLines[bp.line].trim();

					// if a line is empty or starts with '//' we don't allow to set a breakpoint but move the breakpoint down
					if (srcLine.length === 0 || srcLine.startsWith('//')) {
						bp.line++;
					}
					bp.verified = true;
					this.printDebugMsg("validated bp " + bp.line + ': ' + sourceLines[bp.line].trim());
					this.sendEvent('breakpointValidated', bp);
				}
			});
		}
	}

	private fireEventsForLine(ln: number, stepEvent?: string): boolean {

		if (ln >= this._sourceLines.length) {
			return false;
		}
		const line = this._sourceLines[ln].trim();
		if (line.startsWith('//')) {
			this._originalLine++;
			return this.fireEventsForLine(this._originalLine, stepEvent);
		}

		// is there a breakpoint?
		let bp = this.getBreakPoint(ln);
		if (bp) {
			this.sendEvent('stopOnBreakpoint');
			if (!bp.verified) {
				bp.verified = true;
				this.sendEvent('breakpointValidated', bp);
			}
			return true;
		}
		if (stepEvent && line.length > 0) {
			this.sendEvent(stepEvent);
			this.printDebugMsg('sent event ' + stepEvent + ', ln:' + ln);
			return true;
		}

		return false;
	}

	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}

	private initFunctionNames() : void {
		let ifelse = "if(condition) { ... } elif (condition) {} else {}: if-elif-else control flow. Curly braces {} are mandatory!";
		this._functionsMap.set("if", ifelse);
		this._functionsMap.set("elif", ifelse);
		this._functionsMap.set("else", ifelse);
		this._functionsMap.set("while", "while(condition) { ... }: While control flow. Curly braces {} are mandatory!");
		this._functionsMap.set("for", "for(i : array) OR for(i=0; i<n; i++) { ... }: For control flow statements. Curly braces {} are mandatory!");

		this._functionsMap.set("function", "function f(arg1, arg2, ...) { ... } : CSCS custom interpreted function (use cfunction for pre-compiled functions)");
		this._functionsMap.set("cfunction", "cfunction <retType> f(<type1> arg1, <type2> arg2, ...) { ... } : CSCS function to be precompiled");
		this._functionsMap.set("print", "Print(arg1, arg2, ...): Prints passed arguments to console");
		this._functionsMap.set("write", "Write(arg1, arg2, ...): Prints passed arguments to console on the same line");
		this._functionsMap.set("test",  "Test(arg1, arg2): Tests if arg1 is equal to arg2");
		this._functionsMap.set("isInteger", "IsInteger(arg): Tests if arg is an integer");
		this._functionsMap.set("include", "include(filename): includes CSCS code from the filename");
		this._functionsMap.set("substring", "Substring(arg, from, length): Returns a substring of arg");
		this._functionsMap.set("pstime", "Returns process CPU time in milliseconds");
		this._functionsMap.set("now", "Now(format='HH:mm:ss.fff'): Returns current date-time according to the format");

		this._functionsMap.set("pow", "Pow(base, n): Returns base raised to the power of n");
		this._functionsMap.set("exp", "Exp(x): Returns e (2.718281828...) raised to the power of x");
		this._functionsMap.set("pi", "Pi: Pi constant (3.141592653589793...) ");
		this._functionsMap.set("sin", "Sin(x): Returns sine of x");
		this._functionsMap.set("cos", "Cos(x): Returns cosine of x");

		this._functionsMap.set("size", "Returns number of elements in a list or number of characters in a string");
		this._functionsMap.set("type",  "Returns variable type");
		this._functionsMap.set("upper", "Converts to upper case");
		this._functionsMap.set("lower", "Converts to lower case");
		this._functionsMap.set("first", "Returns first element of a list or a first character of a string");
		this._functionsMap.set("last",  "Returns last element of a list or a last character of a string");
		this._functionsMap.set("tokenize",  "Returns list of tokens after separating the string according to a separator");
		this._functionsMap.set("properties", "{Properties, Type, Size, String, First, Last, Upper, Lower}");
	}
}
