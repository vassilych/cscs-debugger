// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.

(function () {
    const vscode = acquireVsCodeApi();

    const PROMPT = 'REPL> ';

    const oldState = vscode.getState();
    console.log(oldState);

    const output  = document.getElementById('output');
    //const entry   = document.getElementById('entry');
    //const display = document.getElementById('display');

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
    var outputData        = '';
    var arrowMode         = false;
    //display.innerHTML = PROMPT;

    function gotoBottom() {
        output.scrollTop = output.scrollHeight - output.clientHeight;
     }

    function getLastLine(forRepl = true) {
        var content = output.value;
        let lines = content.split('\n');
        let lineNr = forRepl ? lines.length - 2 : lines.length - 1;
        var lastLine = lines[lineNr];
        if (lastLine.startsWith(PROMPT)) {
            lastLine = lastLine.substr(PROMPT.length);
        } else if (lastLine.startsWith(PROMPT.trim())) {
            lastLine = lastLine.substr(PROMPT.trim().length);
        }
        lastLine = lastLine.trim();
        return lastLine;
    }

    function setCursorEnd() {
        let wholeLen = output.value.length;
        output.selectionStart = wholeLen;
        output.selectionEnd = output.selectionStart;
    }

    function isLastLine() {
        let topEnd = outputData.length;
        return output.selectionStart > topEnd + PROMPT.length + 1;
    }

    function resetLastLine(cmd = '') {
        output.value = (outputData == '' ? '' : outputData + '\n') + PROMPT + cmd;
        //vscode.postMessage({command: 'info', text: 'resetLastLine [' + cmd + ']'});
    }

    function startRunning() {
        if (loaded.length == 0) {
            vscode.postMessage({command: 'error', text: 'There are no loaded commands to run.'});
            return;
        }
        running    = true;
        currRunCmd = 0;
        vscode.postMessage({command: 'info', text: 'Running a bulk of ' + loaded.length + ' commands.'});
        sendReplCommand();
    }

    function sendReplCommand() {
        //var cmd = entry.value;
        var cmd =  '';
   
        if (running && currRunCmd < loaded.length) {
            cmd = loaded[currRunCmd];
            currRunCmd++;
            //entry.value = cmd;
        } else {
            cmd = getLastLine();

            if (cmd !== '') {
                history.push(cmd);
            }
            running = false;
            //entry.value = "";
        }

        arrowMode = false;
        //outputData = PROMPT + '<font color="aqua">' + cmd + '</font>' + '\n<br>' + outputData;
        outputData += (outputData == '' ? '' : '\n') + PROMPT + cmd;
        if (!running && cmd === '') {
            resetLastLine();
            return;            
        }
        //display.innerHTML = outputData;
        //vscode.postMessage({ command: 'info', text: 'REPL: ' + cmd + ' running:'+ running});
        vscode.postMessage({ command: 'repl', text: cmd });
    }
    //document.addEventListener('mousedown', function (event) { });
    //document.addEventListener('mouseover', function (event) { });
    document.addEventListener('click', function (event) {
        var active = document.activeElement.id;

        /*if (active === 'output') {
            output.value += '';
            output.focus();
            output.selectionStart = output.value.length;
            output.selectionEnd   = output.selectionStart;
            return;
        }*/
        if (active === 'btnClear') {
            outputData = '';
            output.value = PROMPT;
            return;
        }
        if (active === 'btnSave') {
            vscode.postMessage({command: 'save', text: ''});
            return;
        }
        if (active === 'btnLoad') {
            vscode.postMessage({command: 'load', text: ''});
            return;
        }
        if (active === 'btnRun') {
            startRunning();
            return;
        }
        //let x = event.focus;
    });
    document.addEventListener('keydown', function (event) {
        var active = document.activeElement.id;
        var key = event.key || event.keyCode;

        //if (active !== 'entry') {
        if (key === 'h' && (event.metaKey || event.ctrlKey)) {
            //alert("line1");
            vscode.postMessage({command: 'show_history', text: ''});
            return;
        }
        if (active !== 'output') {
            return;
        }

        if (key === 'x' && (event.metaKey || event.ctrlKey)) {
            outputData = '';
            output.value = PROMPT;
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
        if (key === 'u' && (event.metaKey || event.ctrlKey)) {
            startRunning();
            return;
        }
        if (key === 'c' && event.ctrlKey) {
            let cmd = getLastLine(false);
            outputData += (outputData == '' ? '' : '\n') + PROMPT + cmd + '⌃C';
            resetLastLine();
            return;
        }
        if (key === 'ArrowLeft') {
            let lastLine = getLastLine(false);
            let wholeLen = output.value.length;
            let lineLen  = lastLine.length;
            let delta = (wholeLen - output.selectionEnd - lineLen + 1);
            //vscode.postMessage({command: 'info', text: key + ':' + lastLine + '_' 
            //  + output.selectionStart + '_' + wholeLen + '_' + lineLen + ':' + '->' + delta});
            if (lineLen == 0) {
                resetLastLine();
                setCursorEnd();
                //vscode.postMessage({command: 'info', text: key + 'NEW_VAL ' + delta});
            } else if (delta > 0) {
                output.selectionStart += delta;
                if (lastLine.length == 0) {
                    output.selectionStart += 1;
                }
                output.selectionEnd = output.selectionStart;
            }
            return;
        }
        if (key === 'Backspace') {
            let lastLine = getLastLine(false);
            let wholeLen = output.value.length;
            let lineLen  = lastLine.length;
            let trigger  = wholeLen - output.selectionEnd >= lineLen;
            let editing  = isLastLine();
            //vscode.postMessage({command: 'info', text: key + ': ' + lastLine + '_' 
            //+ output.selectionStart + '_' + output.selectionEnd + '_' + wholeLen + '_' + lineLen + '-->' + trigger + '_'+editing});
            setCursorEnd();
            if (trigger) {
                output.value += ' ';
                output.selectionStart += 1;
                output.selectionEnd = output.selectionStart;
            }
            return;
        }
        if (key === 'Home') {
            setCursorEnd();
            return;
        }

        if (key !== 'ArrowDown' && key !== 'ArrowUp') {
            //var cmd = entry.value;
            //display.innerHTML = PROMPT + cmd + '\n<br>' + outputData;
            arrowMode = false;
            return;
        }

        if (history.length == 0) {
            resetLastLine(cmd);
            return;
        }
        if (!arrowMode) {
            current = key === 'ArrowDown' ? history.length : history.length - 1;
        } else {
            current = key === 'ArrowDown' ? current + 1 : current - 1;
        }

        current = (current >= history.length ? history.length : (current < 0 ? -1 : current));
        var cmd = current >= 0 && current < history.length ?  history[current] : '';
        if (cmd != '') {
            resetLastLine(cmd);
        }

        //let msg = '';
        //for (let i = 0; i < history.length; i++) {
        //    msg += history[i] + '|';
        //}
        //vscode.postMessage({command: 'info', text: key + 'D:' + prev +','+ prev2 +','+current + ',' +
        //   history.length + '->' + cmd + ' '+ arrowMode + ' ' + msg});
        arrowMode = true;
        gotoBottom();
        setCursorEnd();

        //display.innerHTML = PROMPT + cmd + '\n<br>' + outputData;
    });
    document.addEventListener('keyup', function (event) {
        var active = document.activeElement.id;
        //if (active !== 'entry') {
        if (active !== 'output') {
            return;
        }
        var key = event.key || event.keyCode;

        //if (key.toLowerCase().startsWith('c')) {
        //vscode.postMessage({command: 'info', text: key + ' - ' + event.ctrlKey + ' - ' + event.metaKey});
        //}

        if (key === 'Escape' || key === 'Esc') {
            running = false;
            //entry.value = '';
            //display.innerHTML = PROMPT + '\n<br>' + outputData;
            resetLastLine();
            current = history.length - 1;
            arrowMode = false;
            return;
        }
        if (key === 'Enter') {
            running = false;
            sendReplCommand();
            return;
        }
        if (key === 'Home') {
            setCursorEnd();
            let lastLine = getLastLine(false);
            output.selectionStart -= lastLine.length;
            output.selectionEnd    = output.selectionStart;
            return;
        }
        if (key === 'ArrowDown' || key === 'ArrowUp') {
            setCursorEnd();
            return;
        }
        if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Backspace') {
            return;
        }
        let isLast = isLastLine();
        //vscode.postMessage({command: 'info', text: key + ' LAST:' + isLast + ':'+ output.value});
        if (!isLast) {
            let cmd = getLastLine(false);
            let expected = outputData + (outputData == '' ? '' : '\n') + PROMPT + cmd;
            if (output.value != expected) {
                //vscode.postMessage({command: 'info', text: key + ' REPLACE:' + expected});
                output.value = expected;         
                gotoBottom();
                setCursorEnd();
            }
        }    
    });

    /*setInterval(() => {
        //vscode.setState({ count: currentCount });
        state++;
    }, 1000);*/

    // Handle messages sent from the extension to the webview
    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.command) {
            case 'repl_response':
                outputData += '\n' + message.text;
                resetLastLine();
                gotoBottom();
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
                history = new Array;
                loaded  = new Array;
				for (let i = 0; i < lines.length; i++) {    
                    let line = lines[i].trim();
                    if (line === '') {
                        continue;
                    }
                    history.push(line);
                    loaded.push(line);
                }
                arrowMode = running = false;
                current = 0;
                if (history.length > 0) {
                    //entry.value = history[current];
                    //display.innerHTML = PROMPT + entry.value + '\n<br>' + outputData;
                    //outputData += (outputData == '' ? '' : '\n') + PROMPT + history[current];
                }
                vscode.postMessage({command: 'info', text: 'Loaded ' + loaded.length + " commands from " + message.filename});
                break;
            case 'request':
                arrowMode = running = false;
                resetLastLine(message.text + '\n');
                sendReplCommand();
                break;
        }
    });
}());
