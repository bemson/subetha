/*!
 * SubEtha
 * http://github.com/bemson/subetha/
 *
 * Copyright 2014, Bemi Faison
 * Released under the Apache License
 */
/* global define, require */
!function (inAMD, inCJS, scope, undefined) {

  function initSubEtha() {

    // is this needed for npm to augment the "subetha-client" module??
    // is anything needed in here at all for non-amd/cjs loading?
    if (inCJS || inAMD) {
      var subetha = useRequire ? require('subetha-client-pe') : scope.SubEtha;

      // "append" additional plugins?
      subetha = require('subetha-client-ax');

      return subetha;
    }

  }

  // initialize and expose module, based on the environment
  // do nothing in web - since min file is loaded
  // or, bower/component prebuilds dependencies
  if (inAMD) {
    define(initSubEtha);
  } else if (inCJS) {
    module.exports = initSubEtha();
  }
}(
  typeof define === 'function',
  typeof exports != 'undefined',
  this
);