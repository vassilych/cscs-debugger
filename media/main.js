// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.

(function () {
    const vscode    = acquireVsCodeApi();

    const PROMPT          = 'REPL> ';
    const PROMPT_         = PROMPT.trim();
    const EDIT_AREA       = 'output';
    const output          = document.getElementById(EDIT_AREA);

    const DOWN_KEY        = 'k';
    const UP_KEY          = 'i';
    const TIMEOUT         = 5 * 1000;

    var loaded            = new Array;
    var current           = -1;
    var running           = false;
    var currRunCmd        = 0;
    var arrowMode         = false;

    var lastCommand       = '';
    var lastCmdIndex      = -1;
    var selectedText      = '';
    var id                = 1;
    var responseReceived  = 0;

    var cmdCache          = '';
    var textCache         = '';

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

    const prevState = vscode.getState();
    let outputData  = prevState && prevState.outputData ? prevState.outputData : PROMPT;
    let history     = prevState && prevState.history    ? prevState.history : new Array;
    output.value    = outputData;
    let lastLine    = getLastLine();
    if (!lastLine.startsWith(PROMPT_)) {
        output.value += '\n' + PROMPT;
    }

    vscode.postMessage({command: 'request_id', text: ''});
    if (history.length > 0) {
        var arr = new Array;
        for (let  i = 0; i < history.length; i++) {
            let cmd = history[i].trim();
            if (cmd != '') {
                arr.push(cmd);
            }
        }
        history = arr;
    }
    if (history.length > 0) {
        vscode.postMessage({command: 'send_history', history: history});
    } else {
        vscode.postMessage({command: 'request_history', text: ''});
    }
    setCursorEnd();

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

    function isCursorLastLine(modifyOutput = false) {
        let content   = output.value;
        let lines     = content.split('\n');
        let prev      = lines[lines.length - 2];
        let last      = lines[lines.length - 1];
        let index     = output.value.lastIndexOf(prev);
        if (output.selectionStart < index) {
            return false;
        }
        if (modifyOutput) {
            let before = output.value.substr(0, index);
            let cmd = prev + last;
            output.value = before + cmd + '\n';
            //vscode.postMessage({command: 'info', text: 'ind=' + index +',selSt='+output.selectionStart+
            //  ', prev=['+prev+'], last=['+last+']'});
        }
        return true;
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
        if (before !== '' && !before.endsWith('\n')) {
            before += '\n';
        }
        if (!replResponse) {
            output.value = before + PROMPT + cmd;
        } else {
            output.value = before + cmd + '\n' + (running ? '' : PROMPT);
        }
        setCursorEnd();
        //vscode.postMessage({command: 'info', text: 'before [' + before.substr(Math.max(0, before.length - 16))
        //    + '] cmd=' + cmd + ':' + lastIndex+ ' :' + replResponse});
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

    function paste(text) {
        var start    = output.selectionStart;
        var end      = output.selectionEnd;
        var before   = output.value.substr(0, start);
        var after    = output.value.substr(end);
        //vscode.postMessage({command: 'info', text: 'PASTE ' + text + ':' + start +','+end});
        output.value = before + text + after;
        if (isCursorLastLine()) {
            gotoBottom();
        }
        output.focus();
        output.selectionStart = output.selectionEnd = (start + text.length);
    }

    function copyCompleted(text = '') {
        output.selectionStart = output.selectionEnd = output.selectionStart;
    }

    function getSelection() {
        var start = output.selectionStart;
        var end   = output.selectionEnd;
        if (start >= end) {
            end   = output.value.indexOf('\n', start + 1);
            start = output.value.lastIndexOf('\n', start);
        }
        if (start >= end || start < 0) {
            return '';
        }
        var selected = output.value.substr(start, end - start);
        return selected;
    }

    function cacheData() {
        vscode.setState({ outputData: output.value, history: history });
    }

    setInterval(() => {
        cacheData();
    }, 1000);

    function sendReplCommand(cmd = '') {
        if (running && currRunCmd < loaded.length) {
            cmd = loaded[currRunCmd];
            output.value += (output.value.endsWith('\n') ? '' : '\n') + PROMPT + cmd + '\n';
            currRunCmd++;
            //entry.value = cmd;
        } else if (cmd === '') {
            if (running) {
                output.value += PROMPT;
                running = false;
                return;
            }
            cmd = getREPLRequest();
        }

        resetArrowMode();
        cacheData();
        //outputData = PROMPT + '<font color="aqua">' + cmd + '</font>' + '\n<br>' + outputData;
        //vscode.postMessage({ command: 'info', text: 'REPL [' + cmd + '] running:'+ running});
        if (!running && cmd === '') {
            resetLastLine();
            return;
        }
        //display.innerHTML = outputData;
        responseReceived = false;
        vscode.postMessage({ command: 'repl', text: cmd, id: id });
        setTimeout(onReplTimeout, TIMEOUT);
    }

    function onReplTimeout() {
        if (responseReceived) {
            return;
        }
        output.value += "\n*** No response received from the REPL server ***\n" + PROMPT;
        setCursorEnd();
    }

    //document.addEventListener('mouseover', function (event) { });
    document.addEventListener('mousedown', function (event) {
        var active = document.activeElement.id;
        if (active !== EDIT_AREA) {
            return;
        }
        var start    = output.selectionStart;
        var end      = output.selectionEnd;
        selectedText = output.value.substr(start, end - start);
        //vscode.postMessage({command: 'info', text: 'DOWN: ' + start +','+end + ':' + selectedText});
     });

    document.addEventListener('auxclick', function (event) {
        var active = document.activeElement.id;
        if (active !== EDIT_AREA) {
            return;
        }

        var middleButton = event.button == 1;
        //vscode.postMessage({command: 'info', text: 'AUX: ' + middleButton + ':' + selectedText});
        if (!middleButton && selectedText !== '') {
            var addNewLine = !isCursorLastLine();
            paste(selectedText + (addNewLine ? '\n' : ''));
            if (addNewLine) {
                output.selectionStart = output.selectionEnd = (output.selectionStart - 1);
            }
            return;
        }

        vscode.postMessage({command: 'get_clipboard', text: ''});
    });

    function clearScreen() {
        outputData = '';
        output.value = PROMPT;
        setCursorEnd();
    }

    document.addEventListener('click', function (event) {
        var active = document.activeElement.id;

        if (active === 'btnClear') {
            clearScreen();
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
        if (active !== EDIT_AREA) {
            return;
        }
        var key = event.key || event.keyCode;
    
        if (key === 'h' && (event.metaKey || event.ctrlKey)) {
            vscode.postMessage({command: 'show_history', text: ''});
        } else if (key === 'l' && (event.metaKey || event.ctrlKey)) {
            vscode.postMessage({command: 'load', text: ''});
        } else if (key === 's' && (event.metaKey || event.ctrlKey)) {
            vscode.postMessage({command: 'save', text: ''});
        } else if (key === 'd' && (event.metaKey || event.ctrlKey)) {
            clearScreen();
        } else if (key === 'm' && (event.metaKey || event.ctrlKey)) {
            history.length = 0;
            loaded.length  = 0;
            vscode.postMessage({command: 'clear_history', text: ''});
        } else if (key === 'Enter' && (event.shiftKey || event.metaKey)) {
            cmdCache  = getSelection();
            textCache = output.value;
        }
        /* else if (key === 'x' && (event.metaKey || event.ctrlKey)) {
            outputData = '';
            output.value = PROMPT;
        } else if (key === 'u' && (event.metaKey || event.ctrlKey)) {
            startRunning();
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

        /*if (event.shiftKey && (event.ctrlKey || Event.metaKey) && key.toUpperCase === 'V') {
            vscode.postMessage({command: 'info', text: key + ' Meta:' + event.metaKey + ' Ctrl:' + event.ctrlKey});
            vscode.postMessage({command: 'get_clipboard', text: ''});
        }*/

        if (key === 'Escape' || key === 'Esc') {
            running = false;
            //display.innerHTML = PROMPT + '\n<br>' + outputData;
            resetLastLine();
            resetArrowMode();
        } else if (key === 'Enter' && (event.shiftKey || event.metaKey )) {
            running = false;
            output.value = textCache + '\n' + PROMPT + cmdCache + '\n';
            //vscode.postMessage({ command: 'info', text: 'XEnter:' + cmdCache});
            sendReplCommand(cmdCache);
        } else if (key === 'Enter') {
            //vscode.postMessage({ command: 'info', text: 'Enter'});
            running = false;
            let isValid = isCursorLastLine(true);
            if (isValid) {
                sendReplCommand();
            }
        }
    });

    // Handle messages sent from the extension to the webview
    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.command) {
            case 'repl_response':
                responseReceived = true;
                resetLastLine(message.text, true);
                cacheData();
                //var color = message.text.startsWith('Exception thrown') ? 'red' : 'lime';
                //outputData = '<font color="' + color + '">' + message.text + '</font>\n<br>' + outputData;
                //display.innerHTML = PROMPT + '\n<br>' + outputData;
                if (running) {
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
            case 'copy_completed':
                copyCompleted(message.text);
                break;
            case 'id':
                id = message.id;
                break;
        }
    });
}());
