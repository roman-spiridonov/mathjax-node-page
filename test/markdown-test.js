/**
 * Created by Roman Spiridonov <romars@phystech.edu> on 8/25/2017.
 */
const tape = require('tape');
const fs = require('fs');
const mjpage = require('../lib/main.js').mjpage;

function escape(fileStr) {
    return fileStr.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescape(fileStr) {
    return fileStr.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

tape('Markdown test', function(t) {
    t.plan(1);
    let input = "If $m<n$, then $1/m>1/n$";  // in this string, <n$, then $1/m> is treated as a tag by pre-processor unless escaped
    mjpage(escape(input), {
        format: ["TeX"],
        singleDollars: true,
        output: "mml"
    }, {}, function(output) {
        t.equal(output.match(/<math/g).length, 2, 'Result contains two formulas');
    });
});
