# vscode-hexdump

[![GitHub issues](https://img.shields.io/github/issues/stef-levesque/vscode-hexdump.svg)](https://github.com/stef-levesque/vscode-hexdump/issues)
[![GitHub license button](https://img.shields.io/github/license/stef-levesque/vscode-hexdump.svg)](https://github.com/stef-levesque/vscode-hexdump/blob/master/LICENSE.md)
[![VS Code marketplace button](http://vsmarketplacebadge.apphb.com/installs/slevesque.vscode-hexdump.svg)](https://marketplace.visualstudio.com/items?itemName=slevesque.vscode-hexdump)

hexdump for Visual Studio Code

## Description

Display a specified file in hexadecimal

## Main Features

Right-click on a file in the explorer to see *Show hexdump for file*  
![Show hexdump](images/show-hexdump.png)

Hover in the data section to see numerical values  
![Hover DataView](images/hover-dataview.png)

Right-click in the hexdump to see more options  
![Context Menu](images/context-menu.png)

## Commands

* `hexdumpFile` (`ctrl+shift+alt+h`, `cmd+shift+alt+h`) Show hexdump for file
* `editValue` (`shift+enter`) Edit the value under the cursor
* `gotoAddress` (`ctrl+g`) Go to a specific address
* `exportToFile` (`ctrl+s`, `cmd+s`) Export to a binary file

## Installation

1. Install *Visual Studio Code* (1.3.0 or higher)
2. Launch *Code*
3. From the command palette `Ctrl-Shift-P` (Windows, Linux) or `Cmd-Shift-P` (OSX)
4. Select `Install Extension`
5. Choose the extension `hexdump for VSCode`
6. Reload *Visual Studio Code*

## Contributing

1. Fork it!
2. Create your feature branch: `git checkout -b my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin my-new-feature`
5. Submit a pull request :D

## Requirements

Visual Studio Code v1.3.0

## Credits

* [Visual Studio Code](https://code.visualstudio.com/)
* [vscode-docs on GitHub](https://github.com/Microsoft/vscode-docs)
* [hexdump-nodejs on GitHub](https://github.com/bma73/hexdump-nodejs)

## License

[MIT](LICENSE.md)

---

## Changelog

### [0.1.0] 2016-08-17

* Hover to display data values
* Command to toggle between little and big endianness
* Status bar to indicate current endianness

### [0.0.2] 2016-07-12

* Edit value under cursor
* Syntax colorization
* Commands in context menus
* Go to address
* Export to file

### [0.0.1] 2016-06-01

* Display a specified file in hexadecimal

[0.1.0]: https://github.com/stef-levesque/vscode-hexdump/compare/47ae52ae080a531910c1fb9da736f1194d9af5ac...75b1bb35a09a0f87de464a74a51e96099ff90225
[0.0.2]: https://github.com/stef-levesque/vscode-hexdump/compare/ba05da59122e25f39fbcaa39b82e98b7f1f3022e...8cfee8b0398313ca58120ec9d19c38c384042536
[0.0.1]: https://github.com/stef-levesque/vscode-hexdump/commit/ba05da59122e25f39fbcaa39b82e98b7f1f3022e
