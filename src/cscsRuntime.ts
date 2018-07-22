/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';

import { readFileSync } from 'fs';
import { EventEmitter } from 'events';
import { DebugProtocol } from 'vscode-debugprotocol';
import { CscsDebugSession } from './cscsDebug';
//import * as vscode from 'vscode';
//import { OutputChannel, window } from 'vscode';

const Net  = require("net");
const Path = require('path');

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

export class CscsRuntime extends EventEmitter {

	private _debugger = new Net.Socket();
	private _connectType : string;
	private _host : string;
	private _port : number;

	private static _instance: CscsRuntime;

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
	private _finished     = false;
	private _init         = true;
	private _continue     = false;
	private _isException  = false;

	private _queuedCommands = new Array<string>();

	//private _outputChannel : OutputChannel;
	//private _debugSession : CscsDebugSession;

	// the initial (and one and only) file we are 'debugging'
	private _sourceFile: string;
	public get sourceFile() {
		return this._sourceFile;
	}

	// the contents (= lines) of the one and only file
	private _sourceLines: string[];

	// This is the next line that will be 'executed'
	private _originalLine = 0;

	private _stackTrace = new Array<StackEntry>();

	// maps from sourceFile to array of Cscs breakpoints
	private _breakPoints     = new Map<string, CscsBreakpoint[]>();
	private _breakPointMap   = new Map<string, Map<number, CscsBreakpoint>>();

	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private _breakpointId = 1;

	constructor(debugSession : CscsDebugSession) {
		super();
		this.initFunctionNames();
		//this._debugSession = debugSession;
	}

	/**
	 * Start executing the given program.
	 */
	public start(program: string, stopOnEntry: boolean, connectType: string, host: string, port: number) {

		this._connectType = connectType;
		this._host = host;
		this._port = port;

		this.loadSource(program);
		this._originalLine = 0;

		this.verifyBreakpoints(this._sourceFile);

        //this._outputChannel = window.createOutputChannel(program);
		this.connectToDebugger();

		if (stopOnEntry) {
			// we step once
			this.step('stopOnEntry');
		} else {
			// we just start to run until we hit a breakpoint or an exception
			this.continue();
		}

		CscsRuntime._instance = this;
	}

	public static sendRepl(repl : string)
	{
		CscsRuntime._instance.sendToServer('_repl', repl);
	}

	public connectToDebugger() : void {
		this._connected = false;

		if (this._connectType === "sockets") {
			console.log('Connecting to ' + this._port + " on  " + this._host + "...");

			this._debugger.connect(this._port, this._host, () => {
				console.log('Connected to the Debugger Server!');
				this.printInfoMsg('Connected to the server at ' + this._host + ":" + this._port);
				if (this._init) {
				  this.printInfoMsg('Check out the results in the Debug Console Window');
				}
				this._connected = true;
				this._init = false;

				this.sendToServer("file", this._sourceFile);
				this.sendAllBreakpontsToServer();
				for (let i = 0; i < this._queuedCommands.length; i++) {
					this.sendToServer(this._queuedCommands[i]);
				}
				this._queuedCommands.length = 0;
			});

			this._debugger.on('data', (data) => {
				this.processFromDebugger(data);
			});

			this._debugger.on('close', () => {
				if (this._init) { 
					this.printErrorMsg("Couldn't connect to " + this._host + ":" + this._port);
				} /*else {
					this.printWarningMsg('Connection closed');
				}*/
				this._connected = false;
			});
		}
	}
	public sendToServer(cmd : string, data = "") {
		if (this._finished) {
			return;
		}
		if (!this._connected) {
			console.log('Connection not valid. Queueing [' + cmd + '] when connected.');
			this._queuedCommands.push(cmd);
			return;
		}
		this.printDebugMsg('sending to debugger: ' + cmd + ' ' + data);
		this._debugger.write(cmd + "|" + data + "\n");
	}
	public printDebugMsg(msg : string) {
		//console.info('    _' + msg);
	}
	public printCSCSOutput(msg : string, file = "", line = -1) {
		//console.error('CSCS> ' + msg + ' \r\n');
		//console.error();
		file = file === "" ?  this._sourceFile : file;
		line = line >= 0 ? line : this._originalLine >= 0 ? this._originalLine : this._sourceFile.length - 1;
		//this.printDebugMsg("PRINT " + msg + " " + file + " " + line);
		this.sendEvent('output', msg, file, line, 0);
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

	protected processFromDebugger(data : string) {
		let lines = data.toString().split('\n');
		let currLine = 0;
		let response = lines[currLine++];
		let fileStr = lines.length < 2 ? 'X' : lines[1];
		let lineStr = lines.length < 3 ? 'X' : lines[2];
		this.printDebugMsg('got: ' + response + ' ' + fileStr + ' line=' + lineStr + ' len=' + lines.length);
		let startVarsData  = 1;
		let startStackData = 1;

		if (response === 'end') {
			this.disconnectFromDebugger();
			return;
		}
		if (response === 'repl') {
			for (let i = 1; i < lines.length - 1; i++) {
				this.printCSCSOutput(lines[i]);
			}
			return;
		}
		if (response === 'vars' || response === 'next' || response === 'exc') {
			this._localVariables.length = 0;
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
			let filename       = lines[currLine++];
			if (filename !== this._sourceFile) {
				this.loadSource(filename);
			}
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
				value: String(this._originalLine + 1),
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
			let value = tokens.slice(3).join(':');
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

	public disconnectFromDebugger() {
		this.sendToServer('bye');
		console.error('Finished debugging');
		this._connected = false;
		this._finished = true;
		this._debugger.end();
		this.sendEvent('end');
	}

	fillStackTrace(lines : string[], start = 0) : void {
		let id = 0;
		this._stackTrace.length = 0;
		for (let i = start; i < lines.length; i += 3) {
			if (i >= lines.length - 2) {
				break;
			}
			let ln    = Number(lines[i]);
			let file  = lines[i + 1].trim();
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
			frames.push({
				index: 1,
				name:  this._sourceLines[this._originalLine].trim(),
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

	sendAllBreakpontsToServer() {
		let keys = Array.from(this._breakPoints.keys() );
		for (let i = 0; i < keys.length; i ++) {
			let path = keys[i];
			this.sendBreakpontsToServer(path);
		}		
	}

	public setBreakPoint(path: string, line: number) : CscsBreakpoint {
		//path = Path.normalize(path);
		let filename = Path.basename(path);

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
		let filename = Path.basename(this._sourceFile);
		let bpMap = this._breakPointMap.get(filename);
		if (!bpMap) {
			return undefined;
		}
		let bp = bpMap.get(line);
		return bp;
	}

	public clearBreakPoint(path: string, line: number) : CscsBreakpoint | undefined {
		//path = Path.normalize(path);
		path = Path.basename(path);
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
		path = Path.basename(path);
		this._breakPoints.delete(path);
		this._breakPointMap.delete(path);
	}

	private loadSource(filename: string) {
		if (this._sourceFile === filename) {
			return;
		}
		if (this.verifyDebug(filename)) {
			this._sourceFile =  Path.normalize(filename);
			this._sourceLines = readFileSync(this._sourceFile).toString().split('\n');
		}
	}

	private runOnce(stepEvent?: string) {
		this.fireEventsForLine(this._originalLine, stepEvent);
	}

	private verifyBreakpoints(path: string) : void {
		path = Path.normalize(path);
		let localPath = Path.basename(path);
		let bpsMap = this._breakPointMap.get(localPath);
		if (!this.verifyDebug(localPath)) {
			return;
		}
		//this.printDebugMsg("Verifying " + path);
		let sourceLines = this._sourceLines;
		if (sourceLines === null || this._sourceFile !== path) {
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
