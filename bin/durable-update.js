#!/usr/bin/env node

var fs = require('fs');
var program = require('commander');
var _ = require('lodash');
var durableUpdate = require('../src/durable-update');
var options = {
  manifestPath : './package.json',
  loglevel : 'info'
};



function validateLogLevel(loglevel) {
  if ([ 'error', 'warn', 'info', 'verbose', 'debug' ].indexOf(loglevel) >= 0) {
    return loglevel;
  }
  return options.loglevel;
}

function validateManifestPath(path) {
  if (fs.statSync(path).isFile()) {
    return path;
  }
  return options.manifestPath;
}

program
  .usage('-m, --manifest [value]', 'Manifest file (default: \'./package.json\')', validateManifestPath)
  .option('-l, --loglevel [value]', 'One of the following strings (they are in increasing level of verbosity, defaults to "info"): "error", "warn", "info", "verbose", "debug"', validateLogLevel)
  .description('update project dependencies and lock down versions')
  .parse(process.argv);

if (program.loglevel) {
  options.loglevel = program.loglevel;
}
if (program.manifest) {
  options.manifestPath = program.manifest;
}
console.log(options);
durableUpdate(options);

