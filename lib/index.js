const puppeteer = require('puppeteer');
const isUrl = require('is-url');
const cheerio = require('cheerio');
const Promise = require('bluebird');
const os = require('os');
const debug = require('debug')('scrappy');

const {
  isArray,
  isNumber,
  isPlainObject,
  isString,
} = require('lodash');

class Scrappy {
  constructor(concurrency) {
    this.browser = null;
    this.concurrency = isNumber(concurrency) ? concurrency : os.cpus().length;
  }

  async retrieveContent(url, selector = 'body') {
    const page = await this.browser.newPage();

    await page.setViewport({
      height: 720,
      isLandscape: true,
      width: 1280,
    });

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
    });

    await page.waitFor(selector);

    const content = await page.evaluate((sel) => {
      const element = document.querySelector(sel);

      return element ? element.innerHTML : null;
    }, selector);

    await page.close();

    return content;
  }

  getDataFromNode(node, attr = false) {
    return attr ? node.attr(attr) : node.text();
  }

  loadContent(content = '', selector = '') {
    const parts = selector.split('@');
    const xpath = parts[0];
    const attr = parts[1];

    const $ = cheerio.load(content);

    return {
      attr,
      element: $(xpath),
      xpath,
      $,
    };
  }

  handleSelectorString(content = '', selector = '') {
    return new Promise((resolve, reject) => {
      const {
        attr,
        element,
        $
      } = this.loadContent(content, selector);

      const count = element.length;

      debug(`handleSelectorString "${selector}" => ${count}`);

      if (count === 1) {
        resolve(this.getDataFromNode(element, attr));
      } else if (count > 1) {
        resolve(element.map((ind, node) => this.getDataFromNode($(node), attr)).get());
      } else {
        reject(new Error('no element found'));
      }
    });
  }

  handleSelectorObject(content = '', selector = '') {
    return new Promise(async (resolve, reject) => {
      const newObject = {};

      try {
        for (const [key, value] of Object.entries(selector)) {
          newObject[key] = await this.handleSelector(content, value);
        }
      } catch (e) {
        return reject(e);
      }

      resolve(newObject);
    });
  }

  async handleSelectorArray(content = '', [sourceSelector, targetSelector]) {
    const sources = await this.handleSelectorString(content, sourceSelector);

    return Promise.map(sources, source => this.crawl(source, targetSelector), {
      concurrency: this.concurrency,
    });
  }

  handleSelector(content = '', selector) {
    return new Promise((resolve, reject) => {
      if (isString(selector)) {
        resolve(this.handleSelectorString(content, selector));
      } else if (isPlainObject(selector)) {
        resolve(this.handleSelectorObject(content, selector));
      } else if (isArray(selector)) {
        resolve(this.handleSelectorArray(content, selector));
      } else {
        reject(new Error('selector type not valid'));
      }
    });
  }

  async crawl(source, selector) {
    let content = source.toString();

    if (isUrl(source)) {
      debug(`crawl link: ${source}`);
      content = await this.retrieveContent(source);
    }

    return this.handleSelector(content, selector);
  }

  async start(source, selector) {
    const START = Date.now();

    debug('scrappy started');

    this.browser = await puppeteer.launch({
      headless: true,
      ignoreHTTPSErrors: true,
    });

    const result = await this.crawl(source, selector);

    await this.browser.close();

    const END = Date.now();

    debug(`scrappy finished in ${(END - START) / 1000}s`);

    return result;
  }
}

module.exports = Scrappy;
