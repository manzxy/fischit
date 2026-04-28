'use strict';
const chalk = require('chalk');

const colors = {
    cyan:    chalk.cyan,
    magenta: chalk.magenta,
    green:   chalk.green,
    yellow:  chalk.yellow,
    blue:    chalk.blue,
    red:     chalk.red,
    white:   chalk.white,
    grey:    chalk.grey
};

exports.color = (text, color) => (colors[color] || chalk.white)(text);
exports.bgcolor = (text, color) => {
    const bgMap = {
        cyan: chalk.bgCyan, magenta: chalk.bgMagenta,
        green: chalk.bgGreen, yellow: chalk.bgYellow,
        blue: chalk.bgBlue, red: chalk.bgRed
    };
    return (bgMap[color] || chalk.bgWhite)(text);
};
