/*jshint -W056 */
// thx github.com/mafintosh for the delayed network lookup approacj
/*!
 * SubEtha-Bridge v0.0.0
 * http://github.com/bemson/subetha/
 *
 * Copyright, Bemi Faison
 * Released under the MIT License
 */
/* global define, require, module */

/*
LocalStorage keys:
// store network data - all channels and peers
SubEtha Network (se-net)
{
  channelLn: [<channel>, ...],
  channels: {
    <channel>: {
      peerLn: [<peer>, ...],
      peers: {
        <guid>: {
          start: <timestamp>,
          origin: <url>
        }
      }
    }
  }
}

SubEtha Message Bus (se-msg)
{
  bid: <bridge-id>,
  type: <message-type>,
  data: {
    ... // depends on command
  }
}
*/

!function (inAMD, inCJS, localStorage, Array, Date, Math, scope, undefined) {

  // dependent module initializer
  function initSubethaBridge() {

    var
      // externals
      cipher = new ((inCJS || inAMD) ? require('morus') : scope.Morus)(),

      // builtins
      JSONstringify = JSON.stringify,
      JSONparse = JSON.parse,
      LS = localStorage,
      mathRandom = Math.random,

      // prototype aliases
      protoSlice = Array.prototype.slice,
      protoHas = Object.prototype.hasOwnProperty,
      protoClientDrop,

      // guid
      guidPattern = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx',
      rxp_guid = /[xy]/g,

      // version info
      protocolVersion = 'se-0',
      protocolVersionLn = protocolVersion.length,
      protocolVersionLnPlusOne = protocolVersionLn + 1,

      // identification
      bridgeId = guid(),
      bridgeIdLn = bridgeId.length,
      bridgeNetworkName,

      // security
      initialized = 0,
      destroyed = 0,
      backtick = '`',
      lastStamp,
      host = scope.parent,
      speakerKey,
      r_validClientMsg,
      r_validStorageEvent = new RegExp(
        protocolVersion + backtick +
        '[0-9a-f-]{36}' + backtick +
        '\\d+' + '\\{.+\\}$'
      ),
      origin = location.origin || location.protocol + '//' + (location.port ? location.port + ':' : '') + location.hostname,
      storagePfx = protocolVersion + backtick + bridgeId + backtick,
      unsupported =
        // there is no parent
        !host ||
        // the parent is this window
        host === scope ||
        // has no postmessage
        typeof host.postMessage != 'function' ||
        // has no localstorage
        typeof LS != 'object' ||
        typeof LS.getItem != 'function' ||
        typeof LS.setItem != 'function',

      // versioned localstorage keys
      netKey = protocolVersion + '-net',
      msgKey = protocolVersion + '-msg',

      // network tracking
      networkClients = {},
      networkClientsCnt = 0,
      networkChannels = {},
      networkChannelCnts = {},
      pendingAuthReqs = {},

      // bridge (local) tracking
      bridgeClients = {},
      bridgeClientsCnt = 0,
      bridgeChannels = {},
      bridgeChannelCnts = {},

      // "net" payload vars
      dropQueue = {},
      joinQueue = {},
      networkChangeTimer,

      // "client" payload
      relayQueue = [],
      relayQueueLocked = 0,

      // events
      AUTH_EVENT = '::auth',
      RELAY_EVENT = '::relay',
      MSG_EVENT = '::message',

      // RESPONSE CODES
      CLIENT_RSP_HANDLED = 1,
      CLIENT_RSP_QUEUED = 1,
      CLIENT_RSP_MALFORMED = 1,
      CLIENT_RSP_DUPLICATE = 1,
      CLIENT_RSP_MISSING_CHANNEL = 1,
      CLIENT_RSP_MISSING_COMMAND = 1,

      // post message utility flag
      canPostObjects = !!function () {
        var yes = 1;

        // synchronous check for postMessage object support!
        // thx gregers@http://stackoverflow.com/a/20743286
        try {
          scope.postMessage({
            toString: function () {
              yes = 0;
            }
          }, '*');
        } catch (e) {}

        return yes;
      }(),

      // postmessage
      postMessage = canPostObjects ?
        function (msg) {
          host.postMessage(msg, '*');
        } :
        function (msg) {
          host.postMessage(JSONstringify(msg), '*');
        },

      // flow control
      next =
        // use setImmediate
        (
          typeof setImmediate === 'function' &&
          setImmediate
        ) ||
        // use nextTick (for nodeJS only)
        (inCJS && process.nextTick) ||
        // fallback to slower setTimeout call
        function (fn) {
          setTimeout(fn, 0);
        },

      // dom binding utility
      bind = scope.attachEvent ?
        function (object, eventName, callback) {
          object.attachEvent('on' + eventName, callback);
        } :
        function (object, eventName, callback) {
          object.addEventListener(eventName, callback, false);
        },
      unbind = scope.attachEvent ?
        function (object, eventName, callback) {
          object.detachEvent('on' + eventName, callback);
        } :
        function (object, eventName, callback) {
          object.removeEventListener(eventName, callback, false);
        },


      postMessageCommands = {

        // pass through client event to relevant recipients
        /*
        event data structure
        {                             [payload]
          key: <speaker=key>,
          mid: <guid>,
          type: 'client',
          msg: {                      [msg]
            type: <client-type>,
            from: <guid>,
            to: [...],
            data: ...                 // optional
          }
        }
        */
        client: function (payload, evt) {
          var
            msg = payload.msg,
            initialLength;

          // only queue if client event has proper structure
          if (
            // msg is an object
            typeof msg === 'object' &&
            // type is a string
            isFullString(msg.type) &&
            // comes from a registered client
            protoHas.call(bridgeClients, msg.from)
          ) {
            // get initial queue length - before adding our event
            initialLength = relayQueue.length;
            // queue client message
            relayQueue.push({
              msg: msg,
              sent: evt.timeStamp
            });
            // run queue
            runRelayQueue();
            // if the newly queued event was handled...
            if (relayQueue.length <= initialLength) {
              // return code for "processed"
              return CLIENT_RSP_HANDLED;
            }
            // return code for "in-queue"
            return CLIENT_RSP_QUEUED;
          }
          // return code for "malformed"
          // reasons span from any failed conditional expression
          return CLIENT_RSP_MALFORMED;
        },

        // handle client authentication request
        /*
        event data structure
        {                                 [payload]
          key: <speaker-key>,
          mid: <guid>,
          type: 'auth',
          msg: {                          [msg]
            id: <client-id>,
            channel: <channel-name>,
            creds: [ <credential>, ... ]
          }
        }
        */
        auth: function (payload, evt) {
          // create request object
          var
            clientData = payload.msg,
            clientId = clientData.id,
            creds = clientData.creds,
            request;

          // exit/ignore when already joined or authing
          if (
            protoHas.call(pendingAuthReqs, clientId) ||
            protoHas.call(networkClients, clientId)
          ) {
            return CLIENT_RSP_DUPLICATE;
          }

          // exit if there is no channel specified
          if (!isFullString(clientData.channel)) {
            return CLIENT_RSP_MISSING_CHANNEL;
          }

          // add url to client data
          clientData.origin = evt.origin;
          // create request
          request = new AuthRequest(clientData, payload.mid);

          // if there are no listeners for this event
          if (
            !protoHas.call(bridge, '_evts') ||
            !protoHas.call(bridge._evts, AUTH_EVENT) ||
            !bridge._evts[AUTH_EVENT].length
          ) {
            // auto authenticate user (synchronously)
            request.allow();
          } else {
            // manually authenticate (asynchronously)

            // add to pending clients
            pendingAuthReqs[clientId] = request;
            // increment pending auth request count
            bridge.pendingAuths++;

            // make request unique
            wrapRequestMethods(request);

            // publish authentication request
            if (creds.length) {
              bridge.fire.apply(bridge, [AUTH_EVENT, request].concat(creds));
            } else {
              bridge.fire(AUTH_EVENT, request);
            }
          }
        },

        // handle the host dropping client
        /*
        event data structure
        {                                 [payload]
          key: <speaker-key>,
          mid: <guid>,
          type: 'drop',
          msg: <guid>                          [msg]
        }
        */
        drop: function (payload) {
          var
            clientId = payload.msg,
            client;

          if (protoHas.call(bridgeClients, clientId)) {
            // drop registered client
            client = bridgeClients[clientId];
            // immediately remove client from bridge and network
            unregisterBridgeClient(client);
            unregisterNetworkClient(client);
            // if client was never announced
            if (protoHas.call(joinQueue, clientId)) {
              // simply remove from join queue
              delete joinQueue[clientId];
            } else {
              // (otherwise) prepare broadcast network change
              queueNetworkChange(client, dropQueue);
            }
          } else if (protoHas.call(pendingAuths, clientId)) {
            // ignore auth request
            pendingAuths[clientId].ignore();
          }
        }

      },

      localStorageCommands = {

        // process adding/removing clients from network channels
        /*
        {                   [payload]
          type: 'net',
          bid: <guid>,
          msg: {            [msg]
            joins: [
              {
                id: <guid>,
                origin: <uri>,
                channel: <channel-name>,
                start: <date>,
                bid: <guid>
              },
              ...
            ],
            drops: [
              {
                id: <guid>,
                channel: <channel-name>
              },
              ...
            ]
          }
        }
        */
        net: function (msg) {
          var
            joins = msg.joins,
            drops = msg.drops,
            clientId,
            client,
            clientData,
            ln,
            shareWithHost,
            hostPayload = {joins:[], drops: []};

          // process newly added clients
          ln = joins.length;
          while (ln--) {
            clientData = joins[ln];
            client = new NetworkClient(clientData);
            registerNetworkClient(client);
            fireJoinEvent(client);
            // pass-thru when there are bridge clients in this channel
            if (bridgeChannelCnts[client.channel]) {
              // remove bid member form clientData
              delete clientData.bid;
              hostPayload.joins.push(clientData);
              shareWithHost = 1;
            }
          }

          // process removed clients
          ln = drops.length;
          while (ln--) {

            clientData = drops[ln];
            clientId = clientData.id;

            if (protoHas.call(networkClients, clientId)) {
              // get corresponding network client
              client = networkClients[clientId];
              // unregister from network
              unregisterNetworkClient(client);
              // announce drop
              fireDropEvent(client);
              // pass-thru when there are bridge clients in this channel
              if (bridgeChannelCnts[client.channel]) {
                hostPayload.drops.push(clientData);
                shareWithHost = 1;
              }
            }

          }

          // pass event to host
          if (shareWithHost) {
            msgHost('net', hostPayload);
          }

        },

        // handle client event
        /*
        {                   [payload]
          type: 'client',
          bid: <guid>,
          msg: {           [msg]
            type: <client-type>,
            from: <guid>,
            to: [...],
            data: ...                 // optional
          }
        }
        */
        client: function (msg) {
          // relay to host
          relayToHost(msg);
        }

      },

      // module definition
      bridge = {
        // bridge version
        version: '0.1',
        // protocol version
        protocol: protocolVersion,
        // bridge id
        id: bridgeId,
        // enablement flag
        disabled: unsupported,
        // network name
        network: '',
        // debug level
        debug: 0,
        pendingAuths: 0,
        pendingMessages: 0,
        // destroy
        destroy: function () {
          var clientId;

          if (!initialized || destroyed) {
            return;
          }

          destroyed = 1;

          // disconnect remaining clients
          for (clientId in bridgeClients) {
            bridgeClients[clientId].drop();
          }

          // stop listening for client commands
          unbind(scope, 'message', postMessageRouter);
          // stop listening for local storage commands
          unbind(scope, 'storage', localStorageRouter);
          // stop listening for unload
          unbind(scope, 'unload', bridge.destroy);

          // detach all events
          bridge.off();

          // broadcast changes immediately - skip host since we're exiting
          broadcastNetworkChanges(1);
          // inform host we're gone
          msgHost('die', 123);

          // when no more clients exist
          if (!networkClientsCnt) {
            // delete localstorage msg key - security'ish?
            LS.removeItem(msgKey);
            LS.removeItem(netKey);
          }
        },
        // parse token
        init: function (token) {
          var
            pos = protocolVersion.length,
            allClients,
            ln,
            cipherShift;

          // exit now if already initialized on unsupported platform
          if (initialized || destroyed || unsupported) {
            return;
          }

          // in case this method gets invoked after listening for first ping
          unbind(scope, 'message', handleFirstPing);

          if (
            !isFullString(token) ||
            token.substring(0, pos) != protocolVersion
          ) {
            next(function () {
              bridge.fire('::error', 'invalid initialization token');
            });
            return;
          }

          // account for first backtick
          pos++;

          // get speaker key
          speakerKey = token.substring(pos, token.indexOf(backtick, pos));
          pos += speakerKey.length + 1;

          // exit if no key
          if (isNaN(speakerKey)) {
            return;
          }

          speakerKey *= 1;

          // get bridge network name/id
          bridgeNetworkName = token.substring(pos, token.indexOf(backtick, pos));
          // get bridge network name/id
          if (!bridgeNetworkName) {
            return;
          }

          pos += bridgeNetworkName.length + 1;

          // set cipher parts
          cipherShift = token.substring(pos, token.indexOf(backtick, pos));
          cipher.shift = cipherShift * 1;
          pos += cipherShift.length + 1;
          cipher.map = JSONparse(token.substring(pos));

          // exit if cipher fails - testing with bridge id
          if (cipher.decode(cipher.encode(bridgeNetworkName)) !== bridgeNetworkName) {
            return;
          }

          // all tests passed!
          initialized = 1;

          // capture bridge network
          bridge.network = bridgeNetworkName;

          // create string parser if we can't post objects
          if (!canPostObjects) {
            r_validClientMsg = new RegExp('^{"key":' + speakerKey + ',"mid":"[0-9a-f-]{36}","type":".+?","msg":.+}$');
          }


          // get network channels
          allClients = LS.getItem(netKey);
          // replace with client data with client instance
          if (isFullString(allClients)) {
            try {
              allClients = JSONparse(allClients);
            } catch (e) {
              LS.removeItem(netKey);
              // exit? fail? log?
            }
            if (Array.isArray(allClients)) {
              ln = allClients.length;
              while (ln--) {
                registerNetworkClient(new NetworkClient(allClients[ln]));
              }
            }
          }

          // listen for client commands
          bind(scope, 'message', postMessageRouter);
          // listen for network commands
          bind(scope, 'storage', localStorageRouter);

          // note that we're initialized
          bridge.fire('::initialized');

          if (!destroyed) {
            // listen for when the page closes
            bind(scope, 'unload', bridge.destroy);
            msgHost('ready', origin);
          }
        }
      }
    ;

    // UTILITY FUNCTIONS

    // shallow object merge
    function mix(base) {
      var
        argIdx = 1,
        source,
        member;

      for (; source = arguments[argIdx]; argIdx++) {
        for (member in source) {
          if (protoHas.call(source, member)) {
            base[member] = source[member];
          }
        }
      }
      return base;
    }

    // generates a guaranteed unique id
    function guid() {
      return guidPattern.replace(rxp_guid, guid_helper);
    }

    // guid helper, for replacing characters
    function guid_helper (c) {
      var
        r = mathRandom() * 16 | 0,
        v = c === 'x' ? r : (r & 0x3 | 0x8);

      return v.toString(16);
    }

    // quick check for non-zero length strings
    function isFullString(value) {
      return value && typeof value === 'string';
    }

    // return random amount of whitespace
    function randomPadding() {
      var
        spaces = [],
        count = ~~(mathRandom() * 40);

      while (count--) {
        spaces.push(' ');
      }
      return spaces.join('');
    }

    // FUNCTIONS

    function resolveNetworkChannel(channelName) {
      if (!protoHas.call(networkChannels, channelName)) {
        networkChannels[channelName] = {};
        networkChannelCnts[channelName] = 0;
      }
      return networkChannels[channelName];
    }

    function resolveBridgeChannel(channelName) {
      if (!protoHas.call(bridgeChannels, channelName)) {
        bridgeChannels[channelName] = {};
        bridgeChannelCnts[channelName] = 0;
      }
      return bridgeChannels[channelName];
    }

    // share message with network
    function broadcast(type, msg) {
      LS.setItem(msgKey, storagePfx + lastStamp + JSONstringify({
        type: type,
        bid: bridgeId,
        msg: msg
      }));
    }

    function relayToHost(msg, channelName) {
      var
        viaNetwork = 0,
        fromId,
        bridgeCnt;

      if (!channelName) {
        fromId = msg.from;
        if (!protoHas.call(networkClients, fromId)) {
          // don't relay unknown network clients
          return;
        }
        channelName = networkClients[msg.from].channel;
        viaNetwork = !protoHas.call(bridgeClients, fromId);
      }
      // announce joins & drops now, in case a (network) client is supposed to receive this relay
      broadcastNetworkChanges();
      bridgeCnt = bridgeChannelCnts[channelName];
      // send to host when a target client is local or unspecified
      if (
        (
          !msg.to &&
          (
            (viaNetwork && bridgeCnt) ||
            (!viaNetwork && bridgeCnt > 1)
          )
        ) ||
        (
          msg.to &&
          hasBridgeClient(msg.to)
        )
      ) {
        msgHost('client', msg);
      }
    }

    // send message to host
    function msgHost(type, msg, sent) {
      postMessage(
        // protocol message
        [
          // protocol version
          protocolVersion,
          // network id
          bridgeNetworkName,
          // encode message
          cipher.encode(
            // random head padding
            randomPadding() +
            // json the msg
            JSONstringify({
              mid: guid(),
              type: type,
              sent: sent || new Date(),
              msg: msg
            }) +
            // random tail padding
            randomPadding()
          )
        ]
        // no origin needed
      );
      // alter cipher per message
      cipher.shift++;
    }

    function hasBridgeClient(ids) {
      var i = ids.length;
      while (i--) {
        if (protoHas.call(bridgeClients, ids[i])) {
          return 1;
        }
      }
      return 0;
    }

    // ensures request methods are only invoked once
    function wrapRequestMethods(req) {
      var
        allowFn = req.allow,
        denyFn = req.deny,
        ignoreFn = req.ignore,
        undecided = 1;

      req.allow = function () {
        if (undecided) {
          undecided = 0;
          callFncArgs(req, denyFn, arguments);
          return true;
        }
        return false;
      };

      req.deny = function () {
        if (undecided) {
          undecided = 0;
          callFncArgs(req, allowFn, arguments);
          return true;
        }
        return false;
      };

      req.ignore = function () {
        if (undecided) {
          undecided = 0;
          callFncArgs(req, ignoreFn, arguments);
          return true;
        }
        return false;
      };

    }

    // supports #wrapRequestMethods
    function callFncArgs(obj, fnc, args) {
      if (args.length) {
        return fnc.apply(obj, args);
      }
      return fnc.call(obj);
    }

    // allows handling next client event
    function unlockAndRunQueue() {
      // unlock queue
      relayQueueLocked = 0;
      // resume queue next
      next(runRelayQueue());
    }

    // process next client event
    function runRelayQueue() {
      var request;

      // exit if queue is closed or there are no messages to relay
      if (relayQueueLocked || !relayQueue.length) {
        return;
      }

      // lock queue
      relayQueueLocked = 1;
      // take command off queue and create client message request
      request = new RelayRequest(relayQueue.shift());
      if (
        !protoHas.call(bridge, '_evts') ||
        !protoHas.call(bridge._evts, RELAY_EVENT) ||
        !bridge._evts[RELAY_EVENT].length
      ) {
        request.allow();
      } else {
        wrapRequestMethods(request);

        // announce client event request
        bridge.fire(RELAY_EVENT, request);
      }
    }

    function fireJoinEvent(client) {
      // only fire if still joining
      if (protoHas.call(joinQueue, client.id)) {
        bridge.fire('::join', client);
      }
    }

    function fireDropEvent(client) {
      bridge.fire('::drop', client);
    }

    // add client to given (drop/join) queue and run queue later
    function queueNetworkChange(client, queue) {
      queue[client.id] = client;
      clearTimeout(networkChangeTimer);
      // allow 5ms of additional client activity
      // so we can batch network changes and reduce storage events
      networkChangeTimer = setTimeout(broadcastNetworkChanges, 5);
    }

    // share client drops & joins with network
    function broadcastNetworkChanges(skipHost) {
      var
        jq = joinQueue,
        dq = dropQueue,
        joins = [],
        drops = [],
        clientId,
        client,
        channelId,
        channel,
        payload;

      // clear timer
      clearTimeout(networkChangeTimer);

      // reset queues
      joinQueue = {};
      dropQueue = {};

      for (clientId in jq) {
        client = jq[clientId];
        joins.push(client);
        fireJoinEvent(client);
      }
      for (clientId in dq) {
        client = dq[clientId];
        drops.push({
          id: clientId,
          channel: client.channel
        });
        fireDropEvent(client);
      }

      // only notify when there are joins or drops
      if (joins.length || drops.length) {
        // convert channels to arrays
        allClients = [];
        for (channelId in networkChannels) {
          channel = networkChannels[channelId];
          for (clientId in channel) {
            allClients.push(channel[clientId]);
          }
        }
        // store network channels
        LS.setItem(netKey, JSONstringify(allClients));

        payload = {
          joins: joins,
          drops: drops
        };

        broadcast('net', payload);
        if (!skipHost) {
          msgHost('net', payload);
        }
      }
    }

    // removes pending auth from stack
    function removePendingAuthRequest(request) {
      var clientId = request.client.id;

      if (protoHas.call(pendingAuthReqs, clientId)) {
        delete pendingAuthReqs[clientId];
        bridge.pendingAuths--;
      }
    }

    // add client to network indexes
    function registerNetworkClient(client, networkChannel) {
      var
        clientId = client.id,
        channelName = client.channel;

      // add to network client and channel indexes
      networkClients[clientId] =
      (networkChannel || resolveNetworkChannel(channelName))[clientId] =
        client;

      // increment network channel tally
      networkChannelCnts[channelName]++;
      // increment network client tally
      networkClientsCnt++;

      return client;
    }

    // add client to bridge indexes
    function registerBridgeClient(client, bridgeChannel) {
      var
        clientId = client.id,
        channelName = client.channel;

      // add to network indexes
      registerNetworkClient(client);

      // add to bridge client and channel indexes
      bridgeClients[clientId] =
      (bridgeChannel || resolveBridgeChannel(channelName))[clientId] =
        client;

      // increment network channel tally
      bridgeChannelCnts[channelName]++;
      // increment bridge client tally
      bridgeClientsCnt++;

    }

    // remove client from network indexes
    function unregisterNetworkClient(client) {
      var
        channelName = client.channel,
        clientId = client.id;

      // remove from network index
      delete networkClients[clientId];
      // decrement network client tally
      networkClientsCnt--;

      // if this is the last client in the channel
      if (networkChannelCnts[channelName] === 1) {
        // remove channel
        delete networkChannels[channelName];
        // remove channel tally
        delete networkChannelCnts[channelName];
      } else {
        // remove client from channel
        delete networkChannels[channelName][clientId];
        // decrement channel tally
        networkChannelCnts[channelName]--;
      }

    }

    // remove client from bridge indexes
    function unregisterBridgeClient(client) {
      var
        clientId = client.id,
        channelName = client.channel;

      // remove from network indexes
      // unregisterNetworkClient(client);

      // remove from bridge client index
      delete bridgeClients[clientId];
      // remove from joinQueue - just in case
      delete joinQueue[clientId];

      // if this is the last client in the bridge channel
      if (bridgeChannelCnts[channelName] === 1) {
        // remove bridge group
        delete bridgeChannels[channelName];
        // remove bridge group count tally
        delete bridgeChannelCnts[channelName];
      } else {
        // remove from bridge channel group
        delete bridgeChannels[channelName][clientId];
        // decremenet bridge channel tally
        bridgeChannelCnts[channelName]--;
      }
    }

    // route "message" events
    function postMessageRouter(evt) {
      var
        cmd = evt.data,
        cmdType = typeof cmd,
        cmdName,
        mid,
        securedByRegExp = 0,
        code = CLIENT_RSP_MISSING_COMMAND;

      // capture to cache-bust db changes
      lastStamp = evt.timeStamp;

      // parser
      if (
        !canPostObjects &&
        cmdType === 'string'
      ) {
        // assess json before parsing
        if (r_validClientMsg.test(cmd)) {
          try {
            cmd = JSONparse(cmd);
            securedByRegExp = 1;
          } catch (e) {
            // bad json
            return;
          }
        } else {
          // malformed msg
          return;
        }
      } else if (cmdType !== 'object') {
        // bad msg type
        return;
      }

      // security
      if (
        (
          // trust regexp test or...
          securedByRegExp || (
            // matches key - this supplements origin security
            cmd.key === speakerKey &&
            // has a message identifier
            isFullString((mid = cmd.mid)) &&
            // has a message
            protoHas.call(cmd, 'msg')
          )
        ) &&
        // has a known type
        protoHas.call(postMessageCommands, (cmdName = cmd.type))
      ) {
        code = postMessageCommands[cmdName](cmd, evt);
      }

      // send message receipt
      // msgHost('receipt', {
      //   mid: command.mid,
      //   code: code
      // });
    }

    // route "storage" events
    function localStorageRouter(evt) {
      var
        key = evt.key,
        msg = evt.newValue;

      // exit when...
      if (
        // not the right key
        key != msgKey ||
        // value is not a string
        typeof msg != 'string' ||
        // string is invalid
        !r_validStorageEvent.test(msg)
      ) {
        return;
      }

      // extract "body" of message
      msg = msg.substring(msg.indexOf('{'));

      // exit on parse error
      try {
        msg = JSONparse(msg);
      } catch (e) {
        // log?
        return;
      }

      // second security
      if (
        // not an object
        typeof msg !== 'object' ||
        // message has no msg property
        !protoHas.call(msg, 'msg') ||
        // there is no handler for this message
        !protoHas.call(localStorageCommands, msg.type)
      ) {
        // log?
        return;
      }

      // pass payload to command
      localStorageCommands[msg.type](msg.msg);
    }

    function handleFirstPing(evt) {
      bridge.init(evt.data);
    }

    // CLASSES

    // basic event emitter
    function EventEmitter() {}

    mix(EventEmitter.prototype, {
      on: function (evt, callback, scope) {
        var me = this;

        if (
          isFullString(evt) &&
          typeof callback === 'function'
        ) {
          if (!protoHas.call(me, '_evts')) {
            me._evts = {};
          }
          if (!protoHas.call(me._evts, evt)) {
            me._evts[evt] = [];
          }
          me._evts[evt].push({
            cb: callback,
            ctx: scope || me,
            fctx: arguments.length > 2
          });
        }
        return me;
      },
      off: function (evt, callback, scope) {
        var
          me = this,
          subs,
          keep,
          sub,
          subsIdx = 0,
          noscope = arguments.length < 3,
          remove;

        if (!protoHas.call(me, '_evts') || !arguments.length) {
          me._evts = {};
        } else if (
          isFullString(evt) &&
          protoHas.call(me._evts, evt)
        ) {
          if (callback) {
            subs = me._evts[evt];
            keep = me._evts[evt] = [];
            // determine which binds to keep
            for (; sub = subs[subsIdx]; ++subsIdx) {
              if (
                // callbacks do not match
                sub.cb !== callback ||
                // no scope but one is specified
                (noscope && sub.fctx) ||
                // scopes do not match
                sub.ctx !== scope
              ) {
                // keep this bind
                keep.push(sub);
              }
            }
            if (!keep.length) {
              remove = 1;
            }
          } else {
            remove = 1;
          }
          if (remove) {
            delete me._evts[evt];
          }
        }

        return me;
      },
      fire: function (evt) {
        var
          me = this,
          params,
          subs,
          subsLn,
          subsIdx,
          invokeCallback;

        if (
          isFullString(evt) &&
          protoHas.call(me, '_evts') &&
          protoHas.call(me._evts, evt) &&
          (subs = me._evts[evt]).length
        ) {
          params = protoSlice.call(arguments, 1);
          if (params.length) {
            invokeCallback = function (sub) {
              sub.cb.apply(sub.ctx, params);
            };
          } else {
            invokeCallback = function (sub) {
              sub.cb.call(sub.ctx);
            };
          }
          subsLn = subs.length;
          for (subsIdx = 0; subsIdx < subsLn; ++subsIdx) {
            invokeCallback(subs[subsIdx]);
          }
        }

        return me;
      }
    });

    // make module an event emitter
    mix(bridge, EventEmitter.prototype);

    // exit now if platform is unsupported
    if (unsupported) {
      return bridge;
    }

    // manage request to authorize clients
    function AuthRequest(clientData, mid) {
      var me = this;

      me.client = clientData;
      me.credentials = clientData.creds;
      me.mid = mid;

      // remove creds from clientData
      delete clientData.creds;
    }

    mix(AuthRequest.prototype, {

      // add client to network
      allow: function () {
        var
          me = this,
          clientData = me.client,
          client,
          clientId = clientData.id;

        removePendingAuthRequest(me);

        // respond to auth request and send existing peers
        msgHost('auth', {
          id: clientId,
          ok: true,
          peers: resolveNetworkChannel(clientData.channel)
        });

        client = new BridgeClient(clientData);

        // immediatley track this client
        registerBridgeClient(client);

        // buffer announcing this client to bridges
        queueNetworkChange(client, joinQueue);
      },

      // decline authorization
      deny: function (reason) {
        var me = this;

        removePendingAuthRequest(me);

        msgHost('auth', {
          id: me.client.id,
          ok: false,
          code: typeof reason === 'string' ? reason : ''
        });

      },

      // ignore authorization
      ignore: function () {
        removePendingAuthRequest(this);
      }

    });

    // manage request to relay client events
    function RelayRequest(pkg) {
      var me = this;
      me.sent = pkg.sent;
      me.msg = pkg.msg;
    }

    mix(RelayRequest.prototype, {

      allow: function () {
        var
          me = this,
          msg = me.msg,
          sender = bridgeClients[msg.from],
          channelName = sender.channel;

        // only relay if there are other clients in this channel
        if (networkChannelCnts[channelName] > 1) {
          relayToHost(msg);
          // relay message to network
          broadcast('client', msg);
        }
        unlockAndRunQueue();
      },

      deny: unlockAndRunQueue,

      ignore: unlockAndRunQueue

    });

    // basic client
    function Client(clientData) {
      var me = this;

      if (clientData) {
        me.id = clientData.id;
        me.channel = clientData.channel;
        me.origin = clientData.origin;
      }

    }

    mix(Client.prototype, {

      // remove client from network
      drop: function () {
        var
          me = this,
          clientId = me.id;

        // exit if not a client
        if (protoHas.call(networkClients, clientId)) {

          unregisterNetworkClient(me);

          return true;
        }
        return false;
      }

    });
    // alias for superclass calls
    protoClientDrop = Client.prototype.drop;

    // local clients, created by this bridge
    function BridgeClient(clientData) {
      var me = this;

      Client.call(me, clientData);
      me.start = new Date();
      me.bid = bridgeId;
    }
    BridgeClient.prototype = new Client();

    mix(BridgeClient.prototype, {

      // remove client from network & bridge
      drop: function () {
        var me = this;

        if (protoClientDrop.call(me)) {
          unregisterBridgeClient(me);
          queueNetworkChange(me, dropQueue);
          return true;
        }

        return false;
      }

    });

    // network clients, created by other bridges
    function NetworkClient(clientData) {
      var me = this;

      Client.call(me, clientData);
      me.start = new Date(clientData.start);
      me.bid = clientData.bid;
    }
    NetworkClient.prototype = new Client();

    if (isFullString(scope._subetha)) {
      // use namespaced token if present in global
      bridge.init(scope._subetha);
    } else {
      // await first ping
      bind(scope, 'message', handleFirstPing);
    }

    return bridge;
  }

  // initialize and expose subetha, based on the environment
  if (inAMD) {
    define(initSubethaBridge);
  } else if (inCJS) {
    module.exports = initSubethaBridge();
  } else if (!scope.bridge) {
    scope.bridge = initSubethaBridge();
  }
}(
  typeof define == 'function', // amd test
  typeof exports != 'undefined', // node test
  localStorage, Array, Date, Math, this
);
