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

	private _connected    = false;
	private _init         = true;
	private _continue     = false;
	private _isException  = false;
	private _replSent     = false;

	private _gettingFile  = false;
	private _fileTotal    = 0;
	private _fileReceived = 0;
	private _dataFile     = '';
	private _fileBytes    : Buffer;

	private _gettingData  = false;
	private _dataTotal    = 0;
	private _dataReceived = 0;
	private _dataBytes    : Buffer;

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

	private constructor() {
		super();
		this._instanceId = Data.getNextId();
		this.initFunctionNames();
	}

	public static getInstance(reload = false): CscsRuntime {
		let cscs = CscsRuntime._instance;
		if (cscs == null || reload ||
		   (!cscs._connected && !cscs._init) ||
		    !Data.sameInstance(cscs._instanceId)) {
				CscsRuntime._instance = new CscsRuntime();
		}
		return CscsRuntime._instance;
	}

	public static startRepl(connectType: string, host: string, port: number) {
		let cscs = CscsRuntime.getInstance();
		//cscs.printCSCSOutput('StartREPL ' + host + ":" + port );
		if (cscs._connected) {
			return;
		}
		cscs._connectType = connectType;
		cscs._host = host;
		cscs._port = port;

		cscs.connectToDebugger();
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
		this._originalLine = 0;

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

	public static sendRepl(repl : string)
	{
		let cscs = CscsRuntime.getInstance();
		cscs.connectToDebugger();
		cscs.sendToServer('repl', repl);
	}

	public connectToDebugger() : void {
		if (this._connected) {
			return;
		}

		if (this._connectType === "sockets") {
			this.printCSCSOutput('Connecting to ' + this._host + ":" + this._port + '...', '', -1, ''); // no new line
			//console.log('Connecting to ' + this._host + ":" + this._port + '...');

			this._debugger.setTimeout(10 * 1000);

			this._debugger.connect(this._port, this._host, () => {
				this.printCSCSOutput('Connected to the Debugger Server.');
				//console.log('Connected to ' + this._host + ":" + this._port + '...');

				if (this._init) {
				  this.printInfoMsg('CSCS: Connected to ' + this._host + ":" + this._port +
					'. Check Output CSCS Window for REPL and Debug Console for debugger messages.');
				}
				this._connected = true;
				this._init = false;

				if (!this._replSent && this._sourceFile !== '') {
					let serverFilename = this.getServerPath(this._sourceFile);
					if (serverFilename !== undefined && serverFilename != '') {
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
				if (this._init) {
					this.printCSCSOutput("Timeout connecting to " + this._host + ":" + this._port);
					this.printErrorMsg('Timeout connecting to ' + this._host + ":" + this._port);
					//console.log('Timeout connecting to ' + this._host + ":" + this._port + '...');
					this._connected = false;
					//this._debugger.destroy();
				}
  		});

			this._debugger.on('close', () => {
				if (this._init) {
					this.printCSCSOutput('Could not connect to ' + this._host + ":" + this._port);
					this.printErrorMsg('Could not connect to ' + this._host + ":" + this._port);
				} /*else {
					this.printWarningMsg('Connection closed');
				}*/
				//console.log('Closed connection to ' + this._host + ":" + this._port + '...');
				this._connected = false;
			});
		}
	}
	public sendToServer(cmd : string, data = "") {
		let isRepl = cmd.startsWith('repl');
		//cscs.printCSCSOutput('sendRepl ' + repl + "(" + cscs._instanceId + ")");
		/*if (isRepl && this._sourceFile != '') {
			let msg = 'Cannot execute REPL while debugging.';
			this.printWarningMsg(msg);
			return;
		}*/

		let toSend = cmd;
		if (data != '' || cmd.indexOf('|') < 0) {
			toSend += '|' + data;
		}
		if (!this._connected) {
			//console.log('Connection not valid. Queueing [' + toSend + '] when connected.');
			this._queuedCommands.push(toSend);
			return;
		}

		this._replSent = isRepl;
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
		let lines = data.toString().split('\n');
		let currLine = 0;
		let response = lines[currLine++].trim();
		let startVarsData  = 1;
		let startStackData = 1;

		if (response === 'repl' || response === '_repl') {
			for (let i = 1; i < lines.length - 1; i++) {
				let line = lines[i].trim();
				if (line != '') {
					this.printCSCSOutput(lines[i]);
				}
			}
			if (response === 'repl') {
				this.sendEvent('onReplMessage', data.toString());
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
				if (this._replSent) {
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
			let msg  = lines.length < 2 ? '' : lines[1];
			this.printCSCSOutput('Exception thrown. ' + msg);

			startVarsData = 2;
			let nbVarsLines  = Number(lines[startVarsData]);
			this.fillVars(lines, startVarsData, nbVarsLines);

			startStackData = startVarsData + nbVarsLines + 1;
			this.fillStackTrace(lines, startStackData);

			for (let i = 0; i < this._stackTrace.length; i ++) {
				let entry = this._stackTrace[i];
				this.printCSCSOutput(entry.file + ', line ' + (entry.line+1) + ':\t' + entry.name);
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
			this._hoversMap.set(name, name + " = " + value);
			this._variablesMap.set(name, value);
		}
	}

	disconnectFromDebugger() {
		this.printCSCSOutput('Finished debugging.');
		this.sendToServer('bye');
		this._connected = false;
		this._sourceFile = '';
		this._debugger.end();
		this.sendEvent('end');
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
		let val = this._variablesMap.get(key);
		if (val) {
			return val;
		}
		return "--- unknown ---";
	}
	public getHoverValue(key : string) : string {
		let hover = this._hoversMap.get(key);
		if (hover) {
			return hover;
		}
		hover = this._functionsMap.get(key);
		if (hover) {
			return hover;
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
		//path = Path.normalize(path);
		path = Path.basename(path);
		let data = path;
		let bps = this._breakPoints.get(path) || [];

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
		let filename = Path.resolve(path);

		const bp = <CscsBreakpoint> { verified: false, line, id: this._breakpointId++ };
		let bps = this._breakPoints.get(filename);
		if (!bps) {
			bps = new Array<CscsBreakpoint>();
			this._breakPoints.set(filename, bps);
		}
		bps.push(bp);

		let bpMap = this._breakPointMap.get(filename);
		if (!bpMap) {
			bpMap = new Map<number, CscsBreakpoint>();
		}
		bpMap.set(line, bp);
		this._breakPointMap.set(filename, bpMap);
		if (filename.includes('functions.cscs')) {
			this.printDebugMsg("Verifying " + path);
		}

		this.verifyBreakpoints(path);

		return bp;
	}

	private getBreakPoint(line: number) : CscsBreakpoint  | undefined {
		let bpMap = this._breakPointMap.get(this._sourceFile);
		if (!bpMap) {
			return undefined;
		}
		let bp = bpMap.get(line);
		return bp;
	}

	public clearBreakPoint(path: string, line: number) : CscsBreakpoint | undefined {
		//path = Path.normalize(path);
		path = Path.resolve(path);
		let bpMap = this._breakPointMap.get(path);
		if (bpMap) {
			bpMap.delete(line);
		}

		let bps = this._breakPoints.get(path);
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
		//path = Path.normalize(path);
		path = Path.resolve(path);
		this._breakPoints.delete(path);
		this._breakPointMap.delete(path);
	}

	private loadSource(filename: string) {
		filename = Path.resolve(filename);
		if (this._sourceFile === filename) {
			return;
		}
		if (this.verifyDebug(filename)) {
			this._sourceFile =  filename;
			this._sourceLines = readFileSync(this._sourceFile).toString().split('\n');
		}
	}

	private runOnce(stepEvent?: string) {
		this.fireEventsForLine(this._originalLine, stepEvent);
	}

	private verifyBreakpoints(path: string) : void {
		if (path === undefined || path === null ) {
			return;
		}
		path = Path.normalize(path);
		let localPath = Path.resolve(path);
		let bpsMap = this._breakPointMap.get(localPath);
		if (!this.verifyDebug(localPath)) {
			return;
		}
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
		this._functionsMap.set("print", "print(arg1, arg2, ...): Prints passed arguments to console");
		this._functionsMap.set("write", "write(arg1, arg2, ...): Prints passed arguments to console on the same line");
		this._functionsMap.set("test",  "test(arg1, arg2): Tests if arg1 is equal to arg2");
		this._functionsMap.set("type",  "type(arg): Returns type of the passed arg");
		this._functionsMap.set("isInteger", "isInteger(arg): Tests if arg is an integer");
		this._functionsMap.set("include", "include(filename): includes CSCS code from the filename");
		this._functionsMap.set("substr", "substr(arg, from, length): Returns a substring of arg");

		this._functionsMap.set("pow", "pow(base, n): Returns base raised to the power of n");
		this._functionsMap.set("exp", "exp(x): Returns e (2.718281828...) raised to the power of x");
		this._functionsMap.set("pi", "pi: Pi constant (3.141592653589793...) ");
		this._functionsMap.set("sin", "sin(x): Returns sine of x");
		this._functionsMap.set("cos", "cos(x): Returns cosine of x");
	}
}
