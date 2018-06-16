# CSCS extension for Visual Studio Code

A [Visual Studio Code](https://code.visualstudio.com/) [extension](https://marketplace.visualstudio.com/VSCode) with rich support for the CSCS (Customized Scripting in C#). The CSCS language has been described in [CODE Magazine](http://www.codemag.com/Article/1607081), [MSDN Magazine](https://msdn.microsoft.com/en-us/magazine/mt632273.aspx), and in [this Syncfusion E-book](https://www.syncfusion.com/resources/techportal/details/ebooks/implementing-a-custom-language).

You can also use CSCS for cross-platform mobile develpment with Xamarin. See
[CODE Magazine](http://www.codemag.com/article/1711081) and [MSDN Magazine](https://msdn.microsoft.com/en-us/magazine/mt829272). A Syncfusion E-book is coming up sometime in Sommer 2018.

This extention contains CSCS code syntax highlighting and supports debugging (including step-in, step-out, breakpoints, etc.)

## Quick start

* **Step 1.** [Install a supported version of Python on your system](https://code.visualstudio.com/docs/python/python-tutorial#_prerequisites) (note: that the system install of Python on macOS is not supported).
* **Step 2.** Install the Python extension for Visual Studio Code.
* **Step 3.** Open or create a Python file and start coding!

## Optional steps
* **Step 4.** [Install a linter](https://code.visualstudio.com/docs/python/linting) to get errors and warnings -- you can further customize linting rules to fit your needs.
* **Step 5.** Select your preferred Python interpreter/version/environment using the `Select Interpreter` command.
  + By default we use the one that's on your path.
  + If you have a workspace open you can also click in the status bar to change the interpreter.
* **Step 6.** Install `ctags` for Workspace Symbols, from [here](http://ctags.sourceforge.net/), or using `brew install ctags` on macOS.

For more information you can:
* [Follow our Python tutorial](https://code.visualstudio.com/docs/python/python-tutorial#_prerequisites) with step-by-step instructions for building a simple app.
* Check out the [Python documentation on the VS Code site](https://code.visualstudio.com/docs/languages/python) for general information about using the extension.

## Useful commands

Open the Command Palette (Command+Shift+P on macOS and Ctrl+Shift+P on Windows/Linux) and type in one of the following commands:

Command | Description
--- | ---
```Python: Select Interpreter``` | Switch between Python interpreters, versions, and environments.
```Python: Create Terminal``` | Create a VS Code terminal with the selected Python interpreter (environment) activated.
```Python: Start REPL``` | Start an interactive Python REPL using the selected interpreter in the VS Code terminal.
```Python: Run Python File in Terminal``` | Runs the active Python file in the VS Code terminal. You can also run a Python file by right-clicking on the file and selecting ```Run Python File in Terminal```.
```Python: Select Linter``` | Switch from PyLint to flake8 or other supported linters.

To see all available Python commands, open the Command Palette and type ```Python```.


## Questions, issues, feature requests, and contributions

* If you have a question about how to accomplish something with the extension or come across a problem with the extension, please [ask me](http://www.ilanguage.ch/p/contact.html)

## Feature details

* IDE-like features
  + Automatic indenting
  + Code navigation ("Go to", "Find all" references)
  + Code definition (Peek and hover definition, View signatures)
  + Rename refactoring
  + Sorting import statements (use the `Python: Sort Imports` command)
* Intellisense and autocomplete (including PEP 484 and PEP 526 support)
  + Ability to include custom module paths (e.g. include paths for libraries like Google App Engine, etc.; use the setting `python.autoComplete.extraPaths = []`)
* Code formatting
  + Auto formatting of code upon saving changes (default to 'Off')
  + Use either [yapf](https://pypi.org/project/yapf/), [autopep8](https://pypi.org/project/autopep8/), or [Black](https://pypi.org/project/black/) for code formatting (defaults to autopep8)
* Linting
  + Support for multiple linters with custom settings (default is [Pylint](https://pypi.org/project/pylint/), but [Prospector](https://pypi.org/project/prospector/), [Flake8](https://pypi.org/project/flake8/), [pylama](https://pypi.org/project/pylama/), [pydocstyle](https://pypi.org/project/pydocstyle/), and [mypy](https://pypi.org/project/mypy/) are also supported)
* Debugging
  + Watch window
  + Evaluate expressions
  + Step through code ("Step in", "Step out", "Continue")
  + Add/remove breakpoints
  + Local variables and arguments
  + Multi-threaded applications
  + Web applications (such as [Flask](http://flask.pocoo.org/) & [Django](https://www.djangoproject.com/), with template debugging)
  + Expanding values (viewing children, properties, etc)
  + Conditional breakpoints
  + Remote debugging (over SSH)
  + Google App Engine
  + Debugging in the integrated or external terminal window
  + Debugging as sudo
* Unit testing
  + Support for [unittest](https://docs.python.org/3/library/unittest.html#module-unittest), [pytest](https://pypi.org/project/pytest/), and [nose](https://pypi.org/project/nose/)
  + Ability to run all failed tests, individual tests
  + Debugging unit tests
* Snippets
* Miscellaneous
  + Running a file or selected text in python terminal
* Refactoring
  + Rename refactorings
  + Extract variable refactorings
  + Extract method refactorings
  + Sort imports

![General Features](https://raw.githubusercontent.com/vassilych/cscs-debugger/master/images/vscode_cscs.gif)



## Data and Privacy

The CSCS Extension for Visual Studio Code DOES NOT collect any data from the user.
