# vscode-hexdump

[![GitHub issues](https://img.shields.io/github/issues/stef-levesque/vscode-hexdump.svg)](https://github.com/stef-levesque/vscode-hexdump/issues)
[![GitHub license button](https://img.shields.io/github/license/stef-levesque/vscode-hexdump.svg)](https://github.com/stef-levesque/vscode-hexdump/blob/master/LICENSE.md)
[![VS Code marketplace button](http://vsmarketplacebadge.apphb.com/installs/slevesque.vscode-hexdump.svg)](https://marketplace.visualstudio.com/items?itemName=slevesque.vscode-hexdump)

hexdump for Visual Studio Code

## Description

Display a specified file in hexadecimal

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

### [0.0.2] 2016-07-12

* Edit value under cursor
* Syntax colorization
* Commands in context menus
* Go to address
* Export to file

### [0.0.1] 2016-06-01

* Display a specified file in hexadecimal


[0.0.2]: https://github.com/stef-levesque/vscode-hexdump/compare/ba05da59122e25f39fbcaa39b82e98b7f1f3022e...8cfee8b0398313ca58120ec9d19c38c384042536
[0.0.1]: https://github.com/stef-levesque/vscode-hexdump/commit/ba05da59122e25f39fbcaa39b82e98b7f1f3022e
