let EventEmitter = require('events').EventEmitter;
let fs = require('fs');
let path = require('path');
let yaml = require('js-yaml');
let errors = require('./errors');
let converter = require('sass-convert');

export default class Environment extends EventEmitter {

  /**
   * @param {Logger} logger
   * @param {Boolean} strict
   */
  constructor(logger, strict = false) {
    super();

    this.logger = logger;
    this.strict = strict;

    this.on('error', error => {
      let friendlyErrors = [
        errors.Error,
        converter.BinaryError,
        converter.VersionError,
      ];

      if (friendlyErrors.find(c => error instanceof c)) {
        logger.error(error.message);
      } else {
        logger.error('stack' in error ? error.stack : error);
      }
    });

    if (strict) {
      this.on('warning', warning => this.emit('error', warning));
    } else {
      this.on('warning', warning => logger.warn(warning.message));
    }
  }

  /**
   * @param {Object|String} config
   */
  load(config) {
    if (!config) {
      return this.loadDefaultFile();
    }

    if (typeof config === 'string') {
      return this.loadFile(config);
    }

    if (typeof config === 'object') {
      return this.loadObject(config);
    }

    this.emit('error', new errors.Error(
      'Invalid `config` argument, expected string, object or undefined.'
    ));
  }

  /**
   * Merge given configuration object, excluding reserved keys.
   *
   * @param {Object} config
   */
  loadObject(config) {
    if (this.file) {
      this.file = path.resolve(this.file);
      this.dir = path.dirname(this.file);
    }

    for (let k of Object.keys(config)) {
      if (k in this) {
        return this.emit('error', new Error(
          `Reserved configuration key "${k}".`
        ));
      }

      this[k] = config[k];
    }
  }

  /**
   * Get the configuration object from given file.
   *
   * If the file is not found, emit a warning and fallback to default.
   *
   * The `dir` property will be the directory of the given file or the CWD
   * if no file is given. The configuration paths should be relative to
   * it.
   *
   * The given logger will be injected in the configuration object for
   * further usage.
   *
   * @param {String} file
   */
  loadFile(file) {
    this.file = file;

    if (!this.tryLoadCurrentFile()) {
      this.emit('warning', new errors.Warning(`Config file "${file}" not found.`));
      this.logger.warn('Falling back to `.sassdocrc`');
      this.loadDefaultFile();
    }
  }

  /**
   * Try to load default `.sassdocrc` configuration file, or fallback
   * to an empty object.
   */
  loadDefaultFile() {
    this.file = '.sassdocrc';
    this.tryLoadCurrentFile();
  }

  /**
   * Post process the configuration to ensure `package` and `theme`
   * have uniform values.
   *
   * The `package` key is ensured to be an object. If it's a string, it's
   * required as JSON, relative to the configuration file directory.
   *
   * The `theme` key, if present and not already a function, will be
   * resolved to the actual theme function.
   */
  postProcess() {
    if (!this.dir) {
      this.dir = process.cwd();
    }

    if (!this.package) {
      this.package = {};
    }

    if (typeof this.package !== 'object') {
      this.loadPackage();
    }

    if (typeof this.theme !== 'function') {
      this.loadTheme();
    }
  }

  /**
   * Process `this.package`.
   */
  loadPackage() {
    let file = this.resolve(this.package);
    this.package = this.tryParseFile(file);

    if (this.package) {
      return;
    }

    this.emit('warning', new errors.Warning(`Package file "${file}" not found.`));
    this.logger.warn('Falling back to `package.json`.');

    file = this.resolve('package.json');
    this.package = this.tryParseFile(file);

    if (this.package) {
      return;
    }

    this.logger.warn('No package information.');
    this.package = {};
  }

  /**
   * Process `this.theme`.
   */
  loadTheme() {
    this.themeName = this.theme || 'default';

    if (this.theme === undefined) {
      return this.defaultTheme();
    }

    if (this.theme.indexOf('/') === -1) {
      return this.tryTheme(`sassdoc-theme-${this.theme}`);
    }

    return this.tryTheme(this.resolve(this.theme));
  }

  /**
   * Try to load given theme module, or fallback to default theme.
   *
   * @param {String} module
   */
  tryTheme(module) {
    try {
      require.resovle(module);
    } catch (err) {
      this.emit('warning', new errors.Warning(`Theme "${this.theme}" not found.`));
      this.logger.warn('Falling back to default theme.');
      return this.defaultTheme();
    }

    this.theme = require(module);
    let str = Object.prototype.toString;

    if (typeof this.theme !== 'function') {
      this.emit('error', new errors.Error(
        `Given theme is ${str(this.theme)}, expected ${str(str)}.`
      ));

      return this.defaultTheme();
    }

    if (this.theme.length !== 2) {
      this.logger.warn(
        `Given theme takes ${this.theme.length} arguments, expected 2.`
      );
    }
  }

  /**
   * Load `sassdoc-theme-default`.
   */
  defaultTheme() {
    try {
      require.resolve('sassdoc-theme-default');
    } catch (err) {
      this.emit('error', new errors.Error(
        'Holy shit, the default theme was not found!'
      ));
    }

    this.theme = require('sassdoc-theme-default');
  }

  /**
   * Try to load `this.file`, and if not found, return `false`.
   *
   * @return {Boolean}
   */
  tryLoadCurrentFile() {
    let config = this.tryParseFile(this.file);

    if (!config) {
      return false;
    }

    this.load(config);

    return true;
  }

  /**
   * Try `this.parseFile` and return `false` if an `ENOENT` error
   * is thrown.
   *
   * Other exceptions are passed to the `error` event.
   *
   * @param {String} file
   * @return {*}
   */
  tryParseFile(file) {
    try {
      return this.parseFile(file);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        return this.emit('error', e);
      }
    }

    return false;
  }

  /**
   * Load YAML or JSON from given file.
   *
   * @param {String} file
   * @return {*}
   */
  parseFile(file) {
    return yaml.safeLoad(fs.readFileSync(file, 'utf-8'));
  }

  /**
   * Resolve given file from `this.dir`.
   *
   * @param {String} file
   * @return {String}
   */
  resolve(file) {
    return path.resolve(this.dir, file);
  }
}
