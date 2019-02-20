/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {
	Logger, logger,
	LoggingDebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
//import * as vscode from 'vscode';
import { basename } from 'path';
import { CscsRuntime, CscsBreakpoint } from './cscsRuntime';
const { Subject } = require('await-notify');

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "program" to debug. */
	program: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
	connectType?: string;
	serverPort?: number;
	serverHost?: string;
	serverBase?: string;
	/** enable logging the Debug Adapter Protocol */
	trace?: boolean;
}

export class CscsDebugSession extends LoggingDebugSession {

	// we don't support multiple threads, so we can use a hardcoded ID for the default thread
	private static THREAD_ID = 1;

	// a CSCS runtime (or debugger)
	private _runtime: CscsRuntime;

	private _variableHandles = new Handles<string>();

	private _configurationDone = new Subject();

	private _localScope  = 0;

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor() {
		super("cscs-debug.txt");

		// this debugger uses zero-based lines and columns
		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);

		let stdin = process.openStdin();

		stdin.addListener("data", function(d: any) {
			// note:  d is an object, and when converted to a string it will
			// end with a linefeed.  so we (rather crudely) account for that
			// with toString() and then substring()
			console.log("you entered: [" + d.toString().trim() + "]");
		});

		this._runtime = CscsRuntime.getNewInstance(false);

		// setup event handlers
		this._runtime.on('stopOnEntry', () => {
			this.sendEvent(new StoppedEvent('entry', CscsDebugSession.THREAD_ID));
		});
		this._runtime.on('stopOnStep', () => {
			this.sendEvent(new StoppedEvent('step', CscsDebugSession.THREAD_ID));
		});
		this._runtime.on('stopOnBreakpoint', () => {
			this.sendEvent(new StoppedEvent('breakpoint', CscsDebugSession.THREAD_ID));
		});
		this._runtime.on('stopOnException', () => {
			this.sendEvent(new StoppedEvent('exception', CscsDebugSession.THREAD_ID));
		});
		this._runtime.on('breakpointValidated', (bp: CscsBreakpoint) => {
			this.sendEvent(new BreakpointEvent('changed', <DebugProtocol.Breakpoint>{ verified: bp.verified, id: bp.id }));
		});
		this._runtime.on('output', (text: string, filePath: string, line: number, column: number, newLine = '\n') => {
			const e: DebugProtocol.OutputEvent = new OutputEvent(`${text}` + newLine);
			e.body.source = this.createSource(filePath);
			e.body.line = this.convertDebuggerLineToClient(line);
			e.body.column = this.convertDebuggerColumnToClient(column);
			this.sendEvent(e);
		});
		/*this._runtime.on('onInfoMessage', (msg : string) => {
			//vscode.window.showInformationMessage('CSCS: ' + msg);
			console.info(msg);
		});
		this._runtime.on('onWarningMessage', (msg : string) => {
			//vscode.window.showWarningMessage('CSCS: ' + msg);
			console.warn(msg);
		});
		this._runtime.on('onErrorMessage', (msg : string) => {
			//vscode.window.showErrorMessage('CSCS: ' + msg);
			console.error(msg);
		});*/
		this._runtime.on('end', () => {
			this.sendEvent(new TerminatedEvent());
		});
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDoneRequest.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code to use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = true;
		response.body.supportsRestartRequest = true;
		//response.body.supportsModulesRequest = true;

		// make VS Code NOT to show a 'step back' button
		response.body.supportsStepBack = false;

		response.body.supportsSetVariable = false;
		response.body.supportsRestartFrame = false;

		this.sendResponse(response);

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());
	}

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);

		// notify the launchRequest that configuration has finished
		this._configurationDone.notify();
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {

		// make sure to 'Stop' the buffered logging if 'trace' is not set
		logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

		// wait until configuration has finished (and configurationDoneRequest has been called)
		await this._configurationDone.wait(1000);

		let connectType = args.connectType ? args.connectType : "sockets";
		let host = args.serverHost ? args.serverHost : "127.0.0.1";
		let port = args.serverPort ? args.serverPort : 13337;
		let base = args.serverBase ? args.serverBase : "";
		// start the program in the runtime

		//let config = vscode.workspace.getConfiguration('mock-debug');
		//let hostConfig = config.get("serverHost");
		//host =  hostConfig ? hostConfig : "127.0.0.1";
		this._runtime.start(args.program, !!args.stopOnEntry, connectType, host, port, base);

		this.sendResponse(response);
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {

		const path = <string>args.source.path;
		if (!this._runtime.verifyDebug(path)) {
			this.sendResponse(response);
			return;
		}
		const clientLines = args.lines || [];

		// clear all breakpoints for this file
		this._runtime.clearBreakpoints(path);

		// set and verify breakpoint locations
		const actualBreakpoints = clientLines.map(l => {
			let { verified, line, id } = this._runtime.setBreakPoint(path, this.convertClientLineToDebugger(l));
			const bp = <DebugProtocol.Breakpoint> new Breakpoint(verified, this.convertDebuggerLineToClient(line));
			bp.id= id;
			return bp;
		});

		// send back the actual breakpoint positions
		response.body = {
			breakpoints: actualBreakpoints
		};

		this._runtime.sendBreakpontsToServer(path);
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

		response.body = {
			threads: [
				new Thread(CscsDebugSession.THREAD_ID, "thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {

		const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
		const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
		const endFrame = startFrame + maxLevels;

		const stk = this._runtime.stack(startFrame, endFrame);

		response.body = {
			stackFrames: stk.frames.map(f => new StackFrame(f.index, f.name, this.createSource(f.file), this.convertDebuggerLineToClient(f.line))),
			totalFrames: stk.count
		};
		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {

		const frameReference = args.frameId;
		const scopes = new Array<Scope>();
		scopes.push(new Scope("Local", this._variableHandles.create("local_" + frameReference), false));
		scopes.push(new Scope("Global", this._variableHandles.create("global_" + frameReference), true));

		this._localScope  = scopes[0].variablesReference;
		//this._globalScope = scopes[1].variablesReference;

		//console.log('Local: ' + this._localScope + '. Global: ' + this._globalScope);

		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {

		let variables = args.variablesReference === this._localScope ? this._runtime.localVariables :
																	   this._runtime.globalVariables
		response.body = {
			variables: variables
		};
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this._runtime.continue();
		this.sendResponse(response);
	}

	protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments) : void {
		this._runtime.continue();
		this.sendResponse(response);
 	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this._runtime.step();
		this.sendResponse(response);
	}
	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		this._runtime.stepIn();
		this.sendResponse(response);
	}
	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		this._runtime.stepOut();
		this.sendResponse(response);
	}
	protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void {
		this.sendResponse(response);
	}
	protected reverseRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments): void {
		this.sendResponse(response);
	}
	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		this._runtime.disconnectFromDebugger();
		this.sendResponse(response);
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		let reply: string | undefined = undefined;

		if (args.context === 'repl') {
			let repl = args.expression;
			this._runtime.sendToServer('_repl', repl);
		} else if (args.context === 'hover') {
			reply = this._runtime.getHoverValue(args.expression);
		} else if (args.context === 'watch') {
			reply = this._runtime.getVariableValue(args.expression);
		}

		response.body = {
			//result: reply ? reply : `evaluate(context: '${args.context}', '${args.expression}')`,
			result: reply ? reply : "",
			variablesReference: 0
		};
		this.sendResponse(response);
	}

	//---- helpers

	private createSource(filePath: string): Source {
		return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'cscs-adapter-data');
	}
}
