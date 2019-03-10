// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.

(function () {
    const vscode    = acquireVsCodeApi();

    const PROMPT    = 'REPL> ';
    const PROMPT_   = PROMPT.trim();
    const EDIT_AREA = 'output';
    const output    = document.getElementById(EDIT_AREA);

    const DOWN_KEY  = 'k';  
    const UP_KEY    = 'i';  

    const previousState = vscode.getState();
    let outputData      = previousState ? previousState.outputData : '';


    //const entry    = document.getElementById('entry');
    //const display  = document.getElementById('display');

    //entry.focus();
    output.focus();
    let lastCursor        = PROMPT.length;
    output.selectionStart = lastCursor;
    output.selectionEnd   = lastCursor;

    var history           = new Array;
    var loaded            = new Array;
    var current           = -1;
    var running           = false;
    var currRunCmd        = 0;
    var arrowMode         = false;

    var lastCommand       = '';
    var lastCmdIndex      = -1;
    //display.innerHTML = PROMPT;

    function gotoBottom() {
        output.scrollTop = output.scrollHeight - output.clientHeight;
     }

     function setCursorEnd() {
        let wholeLen = output.value.length;
        output.selectionStart = wholeLen;
        output.selectionEnd = output.selectionStart;
        gotoBottom();
        output.focus();
    }

     function getREPLRequest() {
        let content = output.value;
        let index = content.lastIndexOf(PROMPT_);
        if (index < 0) {
            vscode.postMessage({ command: 'warning', text:  'No [' + PROMPT + '] prompt found.'});
            return '';
        }
        let cmd = content.substr(index + PROMPT_.length).trim();
        return cmd;
    }

    function getLastLine(forRepl = false) {
        let content  = output.value;
        let lines    = content.split('\n');
        let lineNr   = forRepl ? lines.length - 2 : lines.length - 1;
        let lastLine = lines[lineNr];
        //vscode.postMessage({command: 'info', text: 'lastLine=' + lastLine});
        return lastLine;
    }
    function getLastLineIndex(forRepl = false) {
        let lastLine = getLastLine(forRepl);
        let index    = output.value.lastIndexOf(lastLine);
        //vscode.postMessage({command: 'info', text: 'getLastLineIndex=' + index});
        return index;
    }

    function getLastLineContent(forRepl = false) {
        let lastLine = getLastLine(forRepl);
        if (lastLine.startsWith(PROMPT_)) {
            lastLine = lastLine.length > PROMPT_.length ? lastLine.substr(PROMPT_.length) : '';
        }
        lastLine = lastLine.trim();
        //vscode.postMessage({command: 'info', text: 'Content [' + lastLine + ']'});
        return lastLine;
    }
    function isLastLine() {
        return output.selectionStart >= getLastLineIndex();
    }

    function resetArrowMode() {
        //if (arrowMode) {
        //    vscode.postMessage({command: 'info', text: 'resetArrowMode [' + lastCmdIndex + ']'});
        //}
        lastCmdIndex = -1;
        lastCommand  = '';
        arrowMode    = false;
    }
    function resetLastLine(cmd = '', replResponse = false) {
        let lastIndex = getLastLineIndex();
        let before = lastIndex > 0 ? output.value.substr(0, lastIndex) : '';
        output.value = before + (replResponse ? '' : PROMPT) + cmd;
        if (replResponse) {
            output.value += '\n' + PROMPT;
        }
        setCursorEnd();
        //vscode.postMessage({command: 'info', text: 'before [' + before + '] ' + ', cmd=' + cmd + ':' + lastIndex});
        //output.value = (outputData == '' ? '' : outputData + '\n') + PROMPT + cmd;
    }

    function startRunning() {
        if (loaded.length == 0) {
            vscode.postMessage({command: 'error', text: 'There are no loaded commands to run.'});
            setCursorEnd();
            return;
        }
        running    = true;
        currRunCmd = 0;
        vscode.postMessage({command: 'info', text: 'Running a bulk of ' + loaded.length + ' commands.'});
        sendReplCommand();
    }

    function paste(text = '') {
        var start    = output.selectionStart;
        var end      = output.selectionEnd;
        var before   = output.value.substr(0, start);
        var after    = output.value.substr(end + 1);
        output.value = before + text + after;
        output.focus();
    }

    function getSelection() {
        var start    = output.selectionStart;
        var end      = output.selectionEnd;
        if (start === end) {
            return '';
        }
        var selected   = output.value.substr(start, end - start);
        return selected;
    }

    function sendReplCommand() {
        //var cmd = entry.value;
        var cmd =  '';
   
        if (running && currRunCmd < loaded.length) {
            cmd = loaded[currRunCmd];
            currRunCmd++;
            //entry.value = cmd;
        } else {
            cmd = getREPLRequest();
            running = false;
            //entry.value = "";
        }

        resetArrowMode();
        //outputData = PROMPT + '<font color="aqua">' + cmd + '</font>' + '\n<br>' + outputData;
        //outputData += (outputData == '' ? '' : '\n') + PROMPT + cmd;
        //vscode.setState({ outputData: outputData });
        //vscode.postMessage({ command: 'info', text: 'REPL [' + cmd + '] running:'+ running});
        if (!running && cmd === '') {
            //vscode.postMessage({command: 'info', text: 'Calling reset cmd=' + cmd});
            resetLastLine();
            return;            
        }
        //display.innerHTML = outputData;
        vscode.postMessage({ command: 'repl', text: cmd });
    }
    //document.addEventListener('mousedown', function (event) { });
    //document.addEventListener('mouseover', function (event) { });
    document.addEventListener('auxclick', function (event) {
        var active = document.activeElement.id;
        var middleButton = event.button == 1;
        if (middleButton && active === EDIT_AREA) {
            vscode.postMessage({command: 'get_clipboard', text: ''});
        }
    });
    document.addEventListener('click', function (event) {
        var active = document.activeElement.id;

        if (active === 'btnClear') {
            outputData = '';
            output.value = PROMPT;
            setCursorEnd();
        } else  if (active === 'btnSave') {
            vscode.postMessage({command: 'save', text: ''});
        } else if (active === 'btnLoad') {
            vscode.postMessage({command: 'load', text: ''});
        } else if (active === 'btnRun') {
            startRunning();
        } else if (active === 'btnHistory') {
            vscode.postMessage({command: 'show_history', text: ''});
        } else if (active === 'btnCopy') {
            vscode.postMessage({command: 'write_clipboard', text: getSelection()});
        } else if (active === 'btnPaste') {
            vscode.postMessage({command: 'get_clipboard', text: ''});
        }
        output.focus();
    });

    document.addEventListener('keydown', function (event) {
        var active = document.activeElement.id;
        var key = event.key || event.keyCode;

        if (active !== EDIT_AREA) {
            return;
        }
    
        if (key === 'h' && (event.metaKey || event.ctrlKey)) {
            vscode.postMessage({command: 'show_history', text: ''});
            return;
        }
        if (key === 'l' && (event.metaKey || event.ctrlKey)) {
            vscode.postMessage({command: 'load', text: ''});
            return;
        }
        if (key === 's' && (event.metaKey || event.ctrlKey)) {
            vscode.postMessage({command: 'save', text: ''});
            return;
        }
        if (key === 'm' && (event.metaKey || event.ctrlKey)) {
            history.length = 0;
            loaded.length  = 0;
            return;
        }
        /*if (key === 'x' && (event.metaKey || event.ctrlKey)) {
            outputData = '';
            output.value = PROMPT;
            return;
        }
        if (key === 'u' && (event.metaKey || event.ctrlKey)) {
            startRunning();
            return;
        }*/

        if (key !== DOWN_KEY && key !== UP_KEY || (!event.metaKey && !event.ctrlKey)) {
            return;
        }

        if (history.length == 0) {
            return;
        } else if (history.length == 1) {
            lastCmdIndex = current = 0;
            lastCommand  = history[0];
            resetLastLine(lastCommand);
            return;
        }

        if (!arrowMode) {
            current = key === DOWN_KEY ? history.length : history.length - 1;
        } else {
            current = key === DOWN_KEY ? current + 1 : current - 1;
        }

        current = (current >= history.length ? history.length : (current < 0 ? -1 : current));
        var cmd = current >= 0 && current < history.length ?  history[current] : '';

        if (key === UP_KEY && lastCmdIndex >= history.length - 1 && cmd == lastCommand) {
            current = history.length - 2;
            cmd = history[current];
        } else if (key === DOWN_KEY && lastCmdIndex <= 0 && cmd == lastCommand) {
            current = 1;
            cmd = history[current];
        }

        if (cmd != '') {
            resetLastLine(cmd);
            lastCommand  = cmd;
        }

        //vscode.postMessage({command: 'info', text: key + ' Cmd: ' + cmd + '(' + current +
        //                             ') last:  ' + lastCommand + '(' + lastCmdIndex + ')'});
        lastCmdIndex = current;
        arrowMode = true;
        setCursorEnd();
    });
    document.addEventListener('keyup', function (event) {
        var active = document.activeElement.id;
        if (active !== EDIT_AREA) {
            return;
        }
        var key = event.key || event.keyCode;

        //if (key.toLowerCase().startsWith('c')) {
        //vscode.postMessage({command: 'info', text: key + ' - ' + event.ctrlKey + ' - ' + event.metaKey});
        //}

        if (event.shiftKey && (event.ctrlKey || Event.metaKey) && key.toUpperCase === 'V') {
            vscode.postMessage({command: 'info', text: key + ' Meta:' + event.metaKey + ' Ctrl:' + event.ctrlKey});
            vscode.postMessage({command: 'get_clipboard', text: ''});
        }

        if (key === 'Escape' || key === 'Esc') {
            running = false;
            //entry.value = '';
            //display.innerHTML = PROMPT + '\n<br>' + outputData;
            resetLastLine();
            //current = history.length - 1;
            resetArrowMode();
            return;
        }
        if (key === 'Enter') {
            running = false;
            sendReplCommand();
            return;
        }
    });

    setInterval(() => {
        vscode.setState({ outputData: outputData });
    }, 1000);

    // Handle messages sent from the extension to the webview
    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.command) {
            case 'repl_response':
                resetLastLine(message.text, true);
                //var color = message.text.startsWith('Exception thrown') ? 'red' : 'lime';
                //outputData = '<font color="' + color + '">' + message.text + '</font>\n<br>' + outputData;
                //display.innerHTML = PROMPT + '\n<br>' + outputData;
                //output.textContent += "\nREPL> " + message.text;

                if (running) {
                    if (currRunCmd >= history.length) {
                        running = false;
                        return;
                    }
                    sendReplCommand();
                }
                break;
            case 'load':
                let lines = message.text.split('\n');
                history.length = 0;
                loaded.length  = 0;
				for (let i = 0; i < lines.length; i++) {    
                    let line = lines[i].trim();
                    if (line === '') {
                        continue;
                    }
                    history.push(line);
                    loaded.push(line);
                }
                running = false;
                resetArrowMode();
                vscode.postMessage({command: 'info', text: 'Loaded ' + loaded.length + " commands from " + message.filename});
                setCursorEnd();
                break;
            case 'request': // Comes if user chooses a command from History
                running = false;
                resetArrowMode();
                resetLastLine(message.text + '\n');
                sendReplCommand();
                break;
            case 'history':
                history = message.history;
                break;
            case 'clipboard_content':
                paste(message.text);
                break;
        }
    });
}());
