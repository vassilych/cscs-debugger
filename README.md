# CSCS Extension for Visual Studio Code

A [Visual Studio Code](https://code.visualstudio.com/) [extension](https://marketplace.visualstudio.com/VSCode) with rich support for CSCS (Customized Scripting in C#). The CSCS scripting language has been described in [CODE Magazine](http://www.codemag.com/Article/1607081), [MSDN Magazine](https://msdn.microsoft.com/en-us/magazine/mt632273.aspx), and in [this Syncfusion E-book](https://www.syncfusion.com/resources/techportal/details/ebooks/implementing-a-custom-language).

You can also use CSCS for cross-platform mobile develpment with Xamarin. See
[CODE Magazine](http://www.codemag.com/article/1711081) and [MSDN Magazine](https://msdn.microsoft.com/en-us/magazine/mt829272). Stay tuned for a Syncfusion E-book "Native Mobile Apps in a Functional Scripting Language Succinctly" coming up in Summer 2018.

This extention contains the CSCS syntax highlighting and supports debugging (including step-in, step-out, breakpoints, call stack, exceptions, etc.)

## Quick start

### Windows/Mac/VS Extensions

* **Step 1.** Download the CSCS parser [Windows/Mac Version](https://github.com/vassilych/cscs).

* **Step 2.** Open the project downloaded in the first step Visual Studio Code and compile it.

* **Step 3.** Start the DebugServer either from Visual Studio Code or from the command-line. The default port is 13337.

* **Step 4.** Start debugging in Visual Studio Code (see the animated gif below).

### Mobile Development/Unity Extension

* **Step 1.** Download the CSCS parser [Mobile Development Version](https://github.com/vassilych/mobile).

* **Step 2.** Open the project downloaded in the first step Visual Studio and compile it.

* **Step 3.** Start the DebugServer either from Visual Studio or from the command-line. The default port is 13337.

* **Step 4.** Start debugging in Visual Studio Code (see the animated gif below).

## Questions, issues, feature requests, and contributions

* If you have a question about how to accomplish something with the extension or come across a problem with the extension, please [ask me](http://www.ilanguage.ch/p/contact.html)

## Debugging Features

* Watch Window
* Local and Global Variables
* Add/Remove Breakpoints
* Step Through Code ("Step in", "Step out", "Continue")
* Call Stack
* Possibility to Step-in to the "include file" Statements and to Any CSCS Function

![General Features](https://raw.githubusercontent.com/vassilych/cscs-debugger/master/images/vscode_cscs.gif)

The corresponding `launch.json` configuration looks like this:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "cscs",
            "request": "launch",
            "name": "CSCS Debugger",
            "program": "${workspaceFolder}/${command:AskForProgramName}",
            "stopOnEntry": true,
            "connectType": "sockets",
            "serverPort": 13337,
            "serverHost": "127.0.0.1"
        }
    ]
}
```

## Data and Privacy

The CSCS Extension for Visual Studio Code DOES NOT collect any data from the user.
