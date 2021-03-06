const nc = require('nested-config');

// `config` extends options for mathjax-node's config method, cf https://github.com/mathjax/MathJax-node/wiki/Configuration-options#configoptions
const mjpageDefaults = {
    // mathjax-node-page specific
    format: ["MathML", "TeX", "AsciiMath"], // determines type of pre-processors to run
    output: '', // global override for output option; 'svg', 'html' or 'mml'
    tex: {}, // configuration options for tex pre-processor
    ascii: {}, // configuration options for ascii pre-processor
    singleDollars: false, // allow single-dollar delimiter for inline TeX
    fragment: false, // return body.innerHTML instead of full document
    cssInline: true,  // determines whether inline css should be added (leaving false still allows to add css as a separate file using beforeSerialization event hook)
    jsdom: {
        // NOTE these are not straight jsdom configuration options (cf. below)
        FetchExternalResources: false,
        ProcessExternalResources: false,
        virtualConsole: true
    },
    //
    // standard mathjax-node options
    //
    displayMessages: false, // determines whether Message.Set() calls are logged
    displayErrors: true, // determines whether error messages are shown on the console
    undefinedCharError: false, // determines whether unknown characters are saved in the error array
    extensions: '', // a convenience option to add MathJax extensions
    fontURL: 'https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.2/fonts/HTML-CSS', // for webfont urls in the CSS for HTML output
    MathJax: {
        tex2jax: require('./tex').defaults,
        ascii2jax: require('./ascii').defaults
    } // options MathJax configuration, see https://docs.mathjax.org
};
const mjstate = {};
// defaults for mathjax-node's typeset method
const mjnodeDefaults = {
    ex: 6, // ex-size in pixels
    width: 100, // width of container (in ex) for linebreaking and tags
    useFontCache: true, // use <defs> and <use> in svg output?
    useGlobalCache: false, // use common <defs> for all equations?
    state: mjstate, // track global state
    linebreaks: false, // do linebreaking?
    equationNumbers: "none", // or "AMS" or "all"
    math: "", // the math to typeset
    html: false, // generate HTML output?
    css: false, // generate CSS for HTML output?
    mml: false, // generate mml output?
    svg: false, // generate svg output?
    speakText: true, // add spoken annotations to svg output?
    speakRuleset: "mathspeak", // set speech ruleset (default (chromevox rules), mathspeak)
    speakStyle: "default", // set speech style (mathspeak:  default, brief, sbrief)
    timeout: 10 * 1000, // 10 second timeout before restarting MathJax
};

const SVG_CSS = `
                            .mjpage .MJX-monospace {
                            font-family: monospace
                            }

                            .mjpage .MJX-sans-serif {
                            font-family: sans-serif
                            }

                            .mjpage {
                            display: inline;
                            font-style: normal;
                            font-weight: normal;
                            line-height: normal;
                            font-size: 100%;
                            font-size-adjust: none;
                            text-indent: 0;
                            text-align: left;
                            text-transform: none;
                            letter-spacing: normal;
                            word-spacing: normal;
                            word-wrap: normal;
                            white-space: nowrap;
                            float: none;
                            direction: ltr;
                            max-width: none;
                            max-height: none;
                            min-width: 0;
                            min-height: 0;
                            border: 0;
                            padding: 0;
                            margin: 0
                            }

                            .mjpage * {
                            transition: none;
                            -webkit-transition: none;
                            -moz-transition: none;
                            -ms-transition: none;
                            -o-transition: none
                            }

                            .mjx-svg-href {
                            fill: blue;
                            stroke: blue
                            }

                            .MathJax_SVG_LineBox {
                            display: table!important
                            }

                            .MathJax_SVG_LineBox span {
                            display: table-cell!important;
                            width: 10000em!important;
                            min-width: 0;
                            max-width: none;
                            padding: 0;
                            border: 0;
                            margin: 0
                            }

                            .mjpage__block {
                            text-align: center;
                            margin: 1em 0em;
                            position: relative;
                            display: block!important;
                            text-indent: 0;
                            max-width: none;
                            max-height: none;
                            min-width: 0;
                            min-height: 0;
                            width: 100%
                            }`;

const defaults = {mjpageConfig: mjpageDefaults, mjnodeConfig: mjnodeDefaults};
exports.createConfig = function(overrides) {
    return nc.create(overrides, defaults);
};

exports.mjpageDefaults = mjpageDefaults;
exports.mjnodeDefaults = mjnodeDefaults;
exports.SVG_CSS = SVG_CSS;
