// Copyright IBM Corp. 2013,2015. All Rights Reserved.
// Node module: loopback-component-storage
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0
'use strict';

// Globalization
const g = require('strong-globalize')();

/**
 * Azure storage based on storage provider
 */

const fs = require('fs'),
  azureStorage = require('azure-storage'),
  path = require('path'),
  stream = require('stream'),
  async = require('async'),
  File = require('./file').File,
  Container = require('./container').Container;

const utils = require('./utils');

module.exports.storage = module.exports; // To make it consistent with pkgcloud

module.exports.File = File;
module.exports.Container = Container;
module.exports.Client = AzureStorageProvider;
module.exports.createClient = function(options) {
  return new AzureStorageProvider(options);
};

function AzureStorageProvider(options) {
  options = options || {};
  this.shareName = options.share;
  if (!this.shareName) throw new Error(g.f('{{AzureStorageProvider}}: datasource must supply a share property', this.shareName));
  this.storageAccount = options.storageAccount;
  this.storageAccessKey = options.storageAccessKey;
  this.fileService = azureStorage.createFileService(this.storageAccount, this.storageAccessKey);
  this.fileService.createShareIfNotExists(this.shareName, (err, result, response) => {
    if (err) throw new Error(g.f('{{AzureStorageProvider}}: error while getting shares list', this.shareName));
    this.share = result;
  });
}

// name must contain only letter, numbers, space, -, _
// as containers can't have child containers, / is forbidden
const namePattern = /^[A-Za-z0-9\ \._-]+$/;
// To detect any file/directory containing dotdot paths
const containsDotDotPaths = /(^|[\\\/])\.\.([\\\/]|$)/;

function validateName(name, cb) {
  if (!name || containsDotDotPaths.test(name)) {
    cb && process.nextTick(cb.bind(null, new Error(g.f('Invalid name: %s', name))));
    if (!cb) {
      console.error(g.f('{{AzureStorageProvider}}: Invalid name: %s', name));
    }
    return false;
  }
  if (namePattern.test(name)) {
    return true;
  } else {
    cb && process.nextTick(cb.bind(null, new Error(g.f('{{AzureStorageProvider}}: Invalid name: %s', name))));
    if (!cb) {
      console.error(g.f('{{AzureStorageProvider}}: Invalid name: %s', name));
    }
    return false;
  }
}

function streamError(errStream, err, cb) {
  process.nextTick(function() {
    errStream.emit('error', err);
    cb && cb(null, err);
  });
  return errStream;
}

const writeStreamError = streamError.bind(null, new stream.Writable());
const readStreamError = streamError.bind(null, new stream.Readable());

AzureStorageProvider.prototype.getContainers = function(cb) {
  cb = cb || utils.createPromiseCallback();

  const self = this;
  let containers = [];
  self.fileService.listFilesAndDirectoriesSegmented(self.shareName, '', null, (err, listResults, response) => {
    if (err) {
      cb && cb(err);
    }else{
      listResults.entries.directories.forEach(directory => {
        containers.push(new Container(self, directory));
      });
      cb && cb(err, containers);
    }
  });
  return cb.promise;
};

AzureStorageProvider.prototype.createContainer = function(options, cb) {
  cb = cb || utils.createPromiseCallback();

  const self = this;
  const name = options.name;
  validateName(name, cb) && this.fileService.createDirectoryIfNotExists(self.shareName, name, (err, directoryResult, response) => {
    if (err) {
      cb && cb(err);
      return;
    }
    cb && cb(err, new Container(self, directoryResult));
  });
  return cb.promise;
};

AzureStorageProvider.prototype.destroyContainer = function(directoryName, cb) {
  cb = cb || utils.createPromiseCallback();

  if (!validateName(directoryName, cb)) return;

  const self = this;
  self.getFiles(directoryName, (err, files) => {
    async.parallel(
      files.map(file => (acb) => self.removeFile(directoryName, file.name, acb)), 
      (err) => {
        if (err) {
          cb && cb(err);
          return;
        }
        self.fileService.deleteDirectoryIfExists(self.shareName, directoryName, (err, response) => {
          if (err) {
            cb && cb(err);
            return;
          }
          cb && cb(err, {result: response});
        });
      }
    );
  });
  return cb.promise;
};

AzureStorageProvider.prototype.getContainer = function(directoryName, cb) {
  cb = cb || utils.createPromiseCallback();

  const self = this;
  if (!validateName(directoryName, cb)) return;

  self.fileService.getDirectoryProperties(self.shareName, directoryName, null, (err, directory, response) => {
    if (err) {
      cb && cb(err);
    }else{
      cb && cb(err, new Container(self, directory));
    }
  });
  return cb.promise;
};

// File related functions
AzureStorageProvider.prototype.upload = function(options, cb) {
  const container = options.container;
  if (!validateName(container)) {
    return writeStreamError(
      new Error(g.f('{{AzureStorageProvider}}: Invalid name: %s', container)),
      cb
    );
  }
  const file = options.remote;
  if (!validateName(file)) {
    return writeStreamError(
      new Error(g.f('{{AzureStorageProvider}}: Invalid name: %s', file)),
      cb
    );
  }
  const self = this;
  try{
    const stream = self.fileService.createWriteStreamToNewFile(self.shareName, container, file, 0, (err, file, response) => {
      if (err) return writeStreamError(err, cb);
      console.log(file, response);
    });
    stream.on('finish', () => stream.emit('success'));
    return stream;
  } catch (e) {
    return writeStreamError(e, cb);
  }
};

AzureStorageProvider.prototype.download = function(options, cb) {
  const container = options.container;
  if (!validateName(container, cb)) {
    return readStreamError(
      new Error(g.f('{{AzureStorageProvider}}: Invalid name: %s', container)),
      cb
    );
  }
  const file = options.remote;
  if (!validateName(file, cb)) {
    return readStreamError(
      new Error(g.f('{{AzureStorageProvider}}: Invalid name: %s', file)),
      cb
    );
  }
  const self = this;
  try {
    return self.fileService.createReadStream(self.shareName, container, file);
  } catch (e) {
    return readStreamError(e, cb);
  }
};

AzureStorageProvider.prototype.getFiles = function(directoryName, options, cb) {
  if (typeof options === 'function' && !(options instanceof RegExp)) {
    cb = options;
    options = false;
  }

  cb = cb || utils.createPromiseCallback();

  if (!validateName(directoryName, cb)) return;
  const self = this;
  let files = [];
  self.fileService.listFilesAndDirectoriesSegmented(self.shareName, directoryName, null, (err, listResults, response) => {
    if (err) {
      cb && cb(err);
    }else{
      listResults.entries.files.forEach(file => {
        files.push(new File(self, file));
      });
      cb && cb(err, files);
    }
  });
  return cb.promise;
};

AzureStorageProvider.prototype.getFile = function(directoryName, fileName, cb) {
  cb = cb || utils.createPromiseCallback();

  const self = this;
  if (!validateName(directoryName, cb)) return;
  if (!validateName(fileName, cb)) return;
  self.fileService.getFileProperties(self.shareName, directoryName, fileName, (err, fileProperties, response) => {
    if (err) {
      cb && cb(err);
      return;
    }
    cb && cb(err, new File(self, fileProperties));
  });
  return cb.promise;
};

AzureStorageProvider.prototype.getUrl = function(options) {
  options = options || {};
  if (!validateName(options.directoryName)) return;
  if (!validateName(options.fileName)) return;
  const self = this;
  const sharedAccessPolicy = {
    AccessPolicy: {
      Permissions: azure.FileUtilities.SharedAccessPermissions.READ,
      Start: Date.now(),
      Expiry: Date.now() + 4 * 3600 * 1000
    }
  };
  const sasToken = self.fileService.generateSharedAccessSignature(self.shareName, options.directoryName, options.fileName, sharedAccessPolicy);
  const url = self.fileService.getUrl(shareName, options.directoryName, options.fileName, sasToken, true);
  return url;
};

AzureStorageProvider.prototype.removeFile = function(directoryName, fileName, cb) {
  cb = cb || utils.createPromiseCallback();

  const self = this;
  if (!validateName(directoryName, cb)) return;
  if (!validateName(fileName, cb)) return;
  self.fileService.deleteFileIfExists(self.shareName, directoryName, fileName, (err, deleted, response) => {
    if (err) {
      cb && cb(err);
      return;
    }
    cb && cb(err, {success: deleted});
  });
  return cb.promise;
};
