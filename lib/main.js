const jsdom = require('jsdom');
const serializeDocument = jsdom.serializeDocument;
const util = require('util');
const debug = require('debug')('mathjax-node-page');
const EventEmitter = require('events').EventEmitter;
const tex2jax = require('./tex.js').tex2jax;
const ascii2jax = require('./ascii.js').ascii2jax;
const mathml = require('./mathml.js').mathml2jax;

const SVG_CSS = require('./config').SVG_CSS;
const createConfig = require('./config').createConfig;

let count = 0;  // global count of jobs (for job IDs)
let mathjax, typeset;  // mathjax-node instance (initialized with exports.init)
let _outputJax = ['mml', 'html', 'svg'];  // output options in typesetConfig
let _outputHandlers = {};  // custom handlers for saving conversion results to DOM
let _started = false;  // is mathjax-node currently working?

/**
 * @typedef {Object} MjPageJob~Config
 * @property options.htmlstring {string} - page to convert
 * @property options.configOptions {object} - mjpageConfig
 * @property options.typesetOptions {object} - mjnodeConfig
  */
/**
 * Each mjpage API call initiates a new mathjax-page job with its configuration.
 * @param id {number} - job id
 * @param options {MjPageJob~Config} - options
 * @param callback {function} - callback that accepts one parameter (output)
 * @constructor
 */

function MjPageJob(id, options, callback) {
    this.id = id || Math.random();
    this.options = options;
    this.callback = callback;

    this._parsedFormulasCache = {};  // keeping state between callbacks
    this._outstandingHandlers = {};  // counter for outstanding async operations on files
}

util.inherits(MjPageJob, EventEmitter);
const _p = MjPageJob.prototype;
_p.constructor = MjPageJob;


/**
 * Run conversion job.
 * @returns {MjPageJob} - returns instance of current job for events and chaining.
 * @fires MjPageJob#beforeConversion
 * @fires MjPageJob#afterConversion
 * @fires MjPageJob#beforeSerialization
 */
_p.run = function() {
    this._config();
    this._preprocess();
    this._convert(this.callback);

    return this;
};


/**
 * Prepare job configuration.
 */
_p._config = function() {
    this.options = createConfig({
        htmlstring: this.options.htmlstring,
      mjpageConfig: this.options.mjpageConfig,
      mjnodeConfig: this.options.mjnodeConfig
    });

    const mjpageConfig = this.options.mjpageConfig,
      mjnodeConfig = this.options.mjnodeConfig;

    // override output options with global option
    if (_outputJax.indexOf(mjpageConfig.output) > -1) {
        for (let jax of _outputJax) {
            mjnodeConfig[jax] = (jax === mjpageConfig.output);
        }
    }

    // generate css for html and svg outputs, if global css option is provided
    if (mjpageConfig.cssInline && (mjnodeConfig['svg'] || mjnodeConfig['html'])) {
        mjnodeConfig['css'] = true;
    }

    return this;
};

/**
 * Preprocess the formulas in the document by wrapping them into appropriate <script type="..."> tag.
 * Type can be one of the following: "math/TeX", "math/inline-TeX", "math/AsciiMath", "math/MathML", "math/MathML-block".
 * @private
 */
_p._preprocess = function() {
    const htmlstring = this.options.htmlstring,
      mjpageConfig = this.options.mjpageConfig;

    // Create jsdom options (cf. defaults for config.jsdom)
    const jsdomConfig = {
        features: {
            FetchExternalResources: mjpageConfig.jsdom.FetchExternalResources,
            ProcessExternalResources: mjpageConfig.jsdom.ProcessExternalResources
        },
        virtualConsole: mjpageConfig.jsdom.virtualConsole
    };
    // translate 'true' option
    // TODO deprecate in favor of explicit default
    if (mjpageConfig.jsdom.virtualConsole === true) {
        jsdomConfig.virtualConsole = jsdom.createVirtualConsole().sendTo(console);
    }

    // set up DOM basics
    const doc = jsdom.jsdom(htmlstring, jsdomConfig);
    const window = doc.defaultView;
    const document = window.document;

    //rewrite custom scripts types from core MathJax
    const rewriteScripts = function(oldType, newType) {
        const scripts = document.querySelectorAll('script[type="' + oldType + '"]');
        for (let script of scripts) script.setAttribute('type', newType);
    };
    rewriteScripts('math/tex', 'math/inline-TeX');
    rewriteScripts('math/tex; mode=display', 'math/TeX');
    rewriteScripts('math/asciimath', 'math/asciiMath');

    // configure mathjax-node
    mathjax.config(mjpageConfig);

    // configure and pre-process
    if (mjpageConfig.format.indexOf('MathML') > -1) {
        window.mathml = mathml;
        window.mathml.config.doc = document;
        window.mathml.PreProcess();
    }

    const tex = new tex2jax(mjpageConfig.MathJax.tex2jax);
    if (mjpageConfig.format.indexOf('TeX') > -1) {
        window.tex = tex;
        window.tex.config.doc = document;
        if (mjpageConfig.singleDollars) {
            window.tex.config.inlineMath.push(['$', '$']);
            window.tex.config.processEscapes = true;
        }
        window.tex.PreProcess();
    }

    const ascii = new ascii2jax(mjpageConfig.MathJax.ascii2jax);
    if (mjpageConfig.format.indexOf('AsciiMath') > -1) {
        window.ascii = ascii;
        window.ascii.config.doc = document;
        window.ascii.PreProcess();
    }

    this.window = window;
    return this;
};

/**
 * Convert formulas in the pre-processed document. All formulas should be wrapped by the appropriate <script type="..."> tag.
 * @param callback {function}
 * @returns {MjPageJob} - instance of current job
 * @private
 */
_p._convert = function(callback) {
    const document = this.window.document;

    const scripts = document.querySelectorAll(`
        script[type="math/TeX"],
        script[type="math/inline-TeX"],
        script[type="math/AsciiMath"],
        script[type="math/MathML"],
        script[type="math/MathML-block"]`
    );

    debug(`The page has the following formulas:`,
      scripts.length ? [].map.call(scripts, el => el && el.outerHTML) : "none");

    // prepare state for async execution
    this._parsedFormulasCache = [];
    this._outstandingHandlers = 0;

    // convert with mathjax-node (async launch)
    let index = 0;
    let script;
    // Start and run mathjax-node
    if (!_started) {
        mathjax.start();
        _started = true;
    }
    while (script = scripts[index]) {
        const conf = this.options.mjnodeConfig;
        const format = conf.format = script.getAttribute('type').slice(5);
        if (format === 'MathML-block') conf.format = 'MathML';
        conf.math = script.text;

        /**
         * @typedef {Object} MjPageJob~ParsedFormula
         * @proprety {number} id - index of formula on the page
         * @property {number} jobID - mjpage job ID; formulas belonging to the same page run have the same jobID
         * @proprety {string} node - DOM node with the formula (contents change before and after conversion)
         * @property {string} sourceFormula - the source formula
         * @property {string} sourceFormat - the source formula format (e.g. "inline-TeX")
         * @property {object} outputFormula - the converted formula result from mathjax-node typeset function;
         * use outputFormula[outputFormat] to get the resulting formula string
         * @property {string} outputFormat - the resulting formula format (e.g. "svg")
         */
        let parsedFormula = {
            id: index,
            jobID: this.id,
            node: script,  // has script element before manipulation
            sourceFormula: conf.math,
            sourceFormat: conf.format,
            outputFormula: null,
            outputFormat: this.getOutputProperty(conf)
        };
        conf.state.parsedFormula = parsedFormula; // for access from typeset callback

        /**
         * Event that runs before individual formula conversion started, but after initial DOM processing.
         * All the formulas are wrapped in script[@type] tags.
         * @event MjPageJob#beforeConversion
         * @param parsedFormula {MjPageJob~ParsedFormula} - formula to be converted
         */
        this.emit("beforeConversion", parsedFormula);

        // create DOM wrapper
        const wrapper = document.createElement('span');
        if (format === 'TeX' || format === 'MathML-block') wrapper.className = 'mjpage mjpage__block';
        else wrapper.className = 'mjpage';
        script.parentNode.replaceChild(wrapper, script);

        typeset(conf, (result, options) => {
            const conf = this.options.mjnodeConfig;
            let parsedFormula = options ? options.state.parsedFormula : result;
            if (!options) console.error("typeset function did not return options object needed for state keeping");
            if (result.errors) {
                console.error(`Formula "${parsedFormula.sourceFormula}" contains the following errors:\n`, result.errors);
                this._outstandingHandlers--;
                return;
            }

            let prop = this.getOutputProperty(conf);
            if (_outputHandlers[prop]) {
                // user defined custom output handler (e.g. for png output)
                _outputHandlers[prop].call(this, wrapper, result[prop]);
            } else {
                // default handling is writing result to wrapper contents (e.g. for html, mml, svg outputs)
                wrapper.innerHTML = result[prop];
            }

            parsedFormula.outputFormula = result;
            parsedFormula.node = wrapper;
            this._parsedFormulasCache.push(parsedFormula);
            // Since this call is async, decrease the counter of async operations to make sure all formulas are processed

            this._outstandingHandlers--;

            /**
             * Event that runs after individual formula conversion completed and DOM was changed.
             * Formula DOM node is a <span class="mjpage..."> wrapper whose contents are the conversion result.
             * @event MjPageJob#afterConversion
             * @param parsedFormula {MjPageJob~ParsedFormula} - converted formula
             */
            this.emit("afterConversion", parsedFormula);
            if (this._outstandingHandlers === 0) {
                this.emit('_ready', index, callback);
            }
        }); // async call

        this._outstandingHandlers++;
        index++;
    }

    // when all formulas are parsed, relies on ready event internally to invoke the cb
    this.once('_ready', this._onReady.bind(this));

    // no formulas to parse, hence call ready event handler immediately
    if (index === 0) {
        this.emit('_ready', index, callback);
    }

    return this;
};

_p._onReady = function(index, callback) {
    // a dummy call to wait for mathjax-node to finish
    const conf = this.options.mjnodeConfig,
        mjpageConfig = this.options.mjpageConfig,
        window = this.window,
        document = window.document;
    conf.format = 'TeX';
    if (!conf.math) conf.math = '';

    typeset(conf, (result) => {
        // NOTE cf https://github.com/mathjax/MathJax-node/issues/283
        if (index > 0) {
            if (conf.svg && !conf.png) result.css = SVG_CSS;
            if (result.css && mjpageConfig.cssInline) {
                let styles = document.createElement('style');
                styles.setAttribute('type', 'text/css');
                styles.appendChild(document.createTextNode(result.css));
                document.head.appendChild(styles);
            }
            if (conf.useGlobalCache) {
                let globalSVG = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                globalSVG.style.display = 'none';
                // TODO `globalSVG.appendChild(document.importNode(state.defs,true))` throws error
                // `globablSVG.appendChild(mjstate.defs)`` throws WrongDocumentError so above seems correct
                globalSVG.innerHTML = conf.state.defs.outerHTML;
                document.body.appendChild(globalSVG);
            }
        }

        // clear cache
        delete this._parsedFormulasCache;
        delete this._outstandingHandlers;
        _started = false;

        /**
         * Event that runs runs when converted page DOM was prepared immediately before serialization.
         * Use to manipulate resulting page DOM. The event handler receives `document` node (jsdom) and page `css`.
         * @event MjPageJob#beforeSerialization
         * @param document {Document} - reference to document element of the parsed DOM
         * @param css {string} - css string result from mathjax
         */
        this.emit('beforeSerialization', document, result.css);

        let output = '';
        if (mjpageConfig.fragment) output = document.body.innerHTML;
        else output = serializeDocument(document);
        window.close();
        callback(output);

        // prevent memory leaks
        this.removeAllListeners('beforeConversion')
        .removeAllListeners('afterConversion')
        .removeAllListeners('beforeSerialization');
    });
};

/**
 * Given mathjax-node configuration, returns the output setting, taking into account output priorities.
 * @param conf {object} - mjnode (typeset) config
 * @returns {string} - one of "svg", "mml", "html"; other options possible if addOutput() call was used to add new output options.
 */
_p.getOutputProperty = function(conf) {
    let res;
    for (let prop of _outputJax) {
        if (conf[prop]) {
            res = prop;
        }
    }

    return res;
};

/**
 * Add new output option and, optionally, assign an output handler for writing result to a DOM node.
 * Can be used to customize DOM result for default outputs, i.e. "html", "svg", "mml".
 * @param output {string} - new output option for mathjax-node (e.g. "png" if you are using mathjax-node-svg2png)
 * @param [handler] {function} - function that takes wrapper DOM element and mjnode conversion result and
 * modifies the DOM element. For example, the following is valid handler: (wrapper, data) => wrapper.innerHTML = data.
 */
exports.addOutput = function(output, handler) {
    if (!_outputJax.includes(output)) {
        _outputJax.push(output);
    }

    if (handler && handler instanceof Function) {
        _outputHandlers[output] = handler;
    }

    return this;
};

/**
 * Initialize mathjax-node-page instance with appropriate mathjax-node.
 * Call when no active tasks are running on mathjax-node.
 * @param [MjNode] {object} - pass custom mathjax-node instance; leave empty for default mathjax-node
 */
exports.init = function(MjNode) {
    if (_started) {
        console.error(`mjpage was already initialized and is currently running.`);
        return;
    }

    mathjax = MjNode || require('mathjax-node');
    typeset = mathjax.typeset;
};

/**
 * Runs mathjax-node-page conversion.
 * @param htmlstring {string} - a string with HTML
 * @param mjpageConfig {object} - specifies page-wide options
 * @param mjnodeConfig {object} - expects mathjax-node configuration options
 * @param callback {function} - called with output result upon completion
 * @returns {MjPageJob} - returns job instance, which is event emitter
 */
exports.mjpage = function(htmlstring, mjpageConfig, mjnodeConfig, callback) {
    // init on the first run
    if (!mathjax) {
        exports.init();
    }

    let job = new MjPageJob(count++, {htmlstring, mjpageConfig, mjnodeConfig}, callback);
    process.nextTick(() => job.run()); // need to run after returning the job to allow event handling
    return job;
};
