/*!
 * SubEtha-Client v0.0.0
 * http://github.com/bemson/subetha/
 *
 * Copyright, Bemi Faison
 * Released under the MIT License
 */
/* global define, require */
!function (inAMD, inCJS, Array, Date, Math, JSON, Object, RegExp, scope, undefined) {

  function initSubEtha() {

    var
      Morus = ((inCJS || inAMD) ? require('morus') : scope.Morus),
      JSONstringify = JSON.stringify,
      JSONparse = JSON.parse,
      mathRandom = Math.random,
      protoHas = Object.prototype.hasOwnProperty,
      protoSlice = Array.prototype.slice,
      doc = document,
      docBody,
      domReady = 0,
      rxp_guid = /[xy]/g,
      guidPattern = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx',
      speakerKey = mathRandom(),
      exchangeDelimiter = '~',
      STATE_INITIAL = 0,
      STATE_QUEUED = 1,
      STATE_PENDING = 2,
      STATE_READY = 3,
      STATE_CLOSING = 4,
      JOIN_EVENT = '::join',
      DROP_EVENT = '::drop',
      CONNECT_EVENT = '::connect',
      DISCONNECT_EVENT = '::disconnect',
      // tests whether a string looks like a domain
      /*
      should pass:
        a.co
        a.co/
        a.com
        a.com/
        a.b.co
        a.b.co/
        a.b.com
        a.b.com/
        a-b.co
        a-b.co/
        a-b.com
        a-b.com/

      in order to prefix with "//"
      */
      r_domainish = /^([\w\-]+\.)+[conmi]\w{1,2}\b/,
      // ensures decoded data looks like a json
      r_jsonish = /^\s*{.+}\s*/,
      // for domainish urls, use http when in "file:" protocol
      networkPrefix = !location.protocol.indexOf('f') ? 'http://' : '//',
      defaultNetwork = 'about:blank',
      defaultChannel = 'public',
      ethaDiv = doc.createElement('div'),
      bridges = {},
      bridgeCnt = 0,
      // clients queued to open (before DOMReady)
      clientQueue = {},
      protocolVersion = 'se-0',
      privateKey = {},
      // add to global queue (before DOMReady)
      addClient = function (client) {
        clientQueue[client.id] = client;
      },
      // remove from global queue (before DOMReady)
      removeClient = function (client) {
        delete clientQueue[client.id];
        setClientState(client, STATE_INITIAL);
      },
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
      postMessage = canPostObjects ?
        function (win, msg) {
          win.postMessage(msg, '*');
        } :
        function (win, msg) {
          win.postMessage(JSONstringify(msg), '*');
        },
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
      isArray = typeof Array.isArray === 'function' ?
        Array.isArray :
        function (obj) {
          return obj instanceof Array;
        },
      objectKeys = typeof Object.keys === 'function' ?
        Object.keys :
        function (obj) {
          var
            ary = [],
            key;

          if (obj && typeof obj === 'object') {
            for (key in obj) {
              if (protoHas.call(obj, key)) {
                ary.push(key);
              }
            }
          }
          return ary;
        },

      /*
      handler signature
        1. bridge instance
        2. msg (in payload)
        3. payload (decoded from event)
        4. native post-message event
      */
      bridgeDataHandlers = {

        // first message expected by bridge
        /*
        payload structure
        {                  [payload]
          mid: <guid>,
          type: "ready",
          sent: <date>,
          msg: <uri>            [msg]
        }
        */
        ready: function (bridge, origin) {
          var
            clients = bridge.clients,
            clientId;

          // cancel timer
          bridge.dDay();

          // capture bridge origin, for logging?
          bridge.origin = origin;

          // note that bridge is ready
          bridge.state = STATE_READY;

          // authorize queued clients
          for (clientId in clients) {
            bridge.auth(clients[clientId]);
          }
        },

        // auth response from bridge
        /*
        payload structure
        {                 [payload]
          mid: <guid>,
          type: "auth",
          sent: <date>,
          msg: {          [msg]
            id: <guid>,
            ok: booly,
            peers: {
              <guid>: {
                id: <guid>,
                channel: <channel-name>,
                origin: <uri>
              },
              ...
            },       // optional for failures
            reason: <string> // optional for faliures
          }
        }
        */
        auth: function  (bridge, msg) {
          var
            channels = bridge.channels,
            clients = bridge.clients,
            clientId = msg.id,
            hasPeers,
            client,
            clientPeers,
            networkPeers,
            peerId,
            channelName;

          if (!protoHas.call(clients, clientId)) {
            // avoid unknown clients
            return;
          }

          // target client
          client = clients[clientId];
          // get peers
          networkPeers = msg.peers;

          // determine whether to keep or reject client
          if (
            // rejected
            !msg.ok ||
            // unwarranted authorization (wrong state client)
            client.state !== STATE_PENDING
          ) {
            // boot client
            bridge.remove(client);
            return;
          }

          // clear peers
          clientPeers = client.peers = {};
          // add pre-existing peers
          for (peerId in networkPeers) {
            hasPeers = 1;
            addPeerToClient(client, networkPeers[peerId]);
          }

          // remove closured creds method - reveals prototyped noOp method
          delete client.creds;

          // add to channel index
          channelName = client.channel;
          if (!protoHas.call(channels, channelName)) {
            channels[channelName] = {};
            bridge.channelCnts[channelName] = 0;
          }
          // add to channels index
          channels[channelName][clientId] = client;
          bridge.channelCnts[channelName]++;

          // announce ready state
          setClientState(client, STATE_READY);

          // announce each peer if we have them and we're still ready
          if (hasPeers && client.state === STATE_READY) {
            for (peerId in clientPeers) {
              client.fire(JOIN_EVENT, clientPeers[peerId]);
            }
          }
        },

        // notify clients of network changes
        /*
        data structure
        {                           [payload]
          mid: <guid>,
          type: "net",
          sent: <date>,
          msg: {                    [msg]
            joins: [
              {
                id: <guid>,
                channel: <channel-name>,
                origin: <url>,
                start: <date>
              },
              ...
            ],
            drops: [
              {
                channel: <channel-name>,
                ids: [ <guid>, ... ]
              },
              ...
            ]
          }
        }
        */
        net: function (bridge, msg) {
          // create unique peers for clients in these channels
          // remove possible "bid" member - to not reveal bridge ids
          var
            channelClients,
            clientId,
            client,
            joins = msg.joins,
            drops = msg.drops,
            peerData,
            peerId,
            peer,
            ln,
            changeSets,
            csLn;


          // handle joins
          ln = joins.length;
          while (ln--) {
            // get peer data
            peerData = joins[ln];
            peerId = peerData.id;

            // get clients in this channel
            channelClients = bridge.channels[peerData.channel];

            // add a unique peer instance to each client in this channel
            for (clientId in channelClients) {
              if (clientId != peerId) {
                addPeerToClient(channelClients[clientId], peerData);
              }
            }

            // fire connect event on each client
            for (clientId in channelClients) {
              if (clientId != peerId) {
                client = channelClients[clientId];
                client.fire(JOIN_EVENT, client.peers[peerId]);
              }
            }
          }

          // handle drops
          ln = drops.length;
          while (ln--) {
            changeSets = [];
            // get peer data
            peerData = drops[ln];
            peerId = peerData.id;

            // get clients in this channel
            channelClients = bridge.channels[peerData.channel];

            // remove peer from each client in this channel
            for (clientId in channelClients) {
              if (clientId != peerId) {
                client = channelClients[clientId];
                peer = client.peers[peerId];
                changeSets.push([client, peer]);
                // set client state
                peer.state = 0;
                delete client.peers[peerId];
              }
            }

            // fire connect event on each client, passing the removed peer
            csLn = changeSets.length;
            while (csLn--) {
              client = changeSets[csLn][0];
              if (client.id != peerId) {
                client.fire(DROP_EVENT, changeSets[csLn][1]);
              }
            }
          }

        },

        // handle killed bridge
        /*
        data structure
        {                           [payload]
          mid: <guid>,
          type: "die",
          sent: <date>,
          msg: <code-number>           [msg]
        }
        */
        die: function (bridge, code) {
          // remove from bridge now, so this bridge can't be reused by a reopening client
          bridge.deref();
          // notify clients
          bridge.destroy();
        },

        // pass-thru client message
        /*
        data structure
        {                           [payload]
          mid: <guid>,
          type: "client",
          sent: <date>,
          msg: {                    [msg]
            type: <client-type>,
            from: <guid>,
            to: [<guid>, ...],
            data: <arbitrary-data>  [data] *optional
          }
        }
        */
        client: function (bridge, msg, payload, evt) {
          var
            clients = bridge.clients,
            peerId = msg.from,
            handlers = Client.prototype.msgs,
            handler,
            clientId,
            clientsLn,
            targetClients;

          // exit when there are no handlers or this type has no handler
          if (
            typeof handlers !== 'object' ||
            !protoHas.call(handlers, msg.type)
          ) {
            return;
          }

          handler = handlers[msg.type];
          targetClients = msg.to;

          if (targetClients) {
            clientsLn = targetClients.length;
            // invoke handler on targeted clients
            while (clientsLn--) {
              checkAndSendCustomEvent(
                clients,
                targetClients[clientsLn],
                peerId,
                handler,
                msg.data,
                payload,
                evt
              );
            }
          } else {
            // invoke handler with all
            for (clientId in clients) {
              checkAndSendCustomEvent(
                clients,
                clientId,
                peerId,
                handler,
                msg.data,
                payload,
                evt
              );
            }
          }
        }

      },

      // public API
      subetha = {

        // number of seconds to wait for the bridge to connect
        bridgeDelay: 8000,

        // path to script for generated bridge
        bridgeScript: 'subetha-bridge.js',

        Client: Client,

        Peer: Peer,

        version: '0.0.0',

        protocol: protocolVersion

      }
    ;

    // build ethadiv
    ethaDiv.style.display = 'none';
    ethaDiv.setAttribute('aria-hidden', 'true');
    ethaDiv.setAttribute('hidden', 'hidden');
    ethaDiv.setAttribute('data-owner', 'subetha');

    // UTILITY

    function noOp() {}

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

    function isFullString(value) {
      return value && typeof value === 'string';
    }

    // FUNCTIONS

    function bridgeOnLoadHandler(bridge) {
      // if onload event fires when queued or pending...
      if (bridge.state < STATE_READY) {
        // send first postMessage to window
        // skipping utility, to avoid double-quotes
        bridge.iframe.contentWindow.postMessage(bridge.ping, '*');
        // (re)set state to pending, since we're now waiting
        bridge.state = STATE_PENDING;
        // allow half time for a response
        // bridge.dDay(subetha.bridgeDelay/2);
      } else {
        // otherwise, destroy bridge
        bridge.destroy();
      }
    }

    function removeEthaDiv() {
      if (docBody.contains(ethaDiv)) {
        // remove ethaDiv from DOM
        docBody.removeChild(ethaDiv);
      }
    }

    // routes all post messages to active bridges
    function bridgeRouter(evt) {
      var
        pkg = evt.data,
        bridge,
        bridgeState,
        payload,
        type;

      // only parse when...
      if (
        // not expecting an object
        !canPostObjects &&
        // the message is a string
        typeof pkg === 'string' &&
        // it looks like an array
        pkg.charAt(0) + pkg.charAt(pkg.length - 1) === '[]'
      ) {
        try {
          pkg = JSONparse(pkg);
        } catch (e) {
          return;
        }
      }

      /*
      evt structure
      {                             [evt]
        origin: <url>,
        data: {                     [payload]
          mid: <guid>,
          type: "...",
          sent: <date>,
          msg: {                     [msg]
            ...
          }
        }
      }
      */

      // security layer
      if (
        // an array
        isArray(pkg) &&
        // the first matches the protocol
        pkg[0] == protocolVersion &&
        // there are three elements total
        pkg.length === 3 &&
        // the second is the network of a known bridge
        protoHas.call(bridges, pkg[1]) &&
        // the bridge is pending or ready
        (bridgeState = (bridge = bridges[pkg[1]]).state) > STATE_INITIAL &&
        bridgeState < STATE_CLOSING &&
        // the third is encoded JSON object
        (payload = bridge.decode(pkg[2])) &&
        // the payload has a msg-id
        isFullString(payload.mid) &&
        // the payload has a sent date
        protoHas.call(payload, 'sent') &&
        // the payload has a message
        protoHas.call(payload, 'msg') &&
        // the payload has a known type
        protoHas.call(bridgeDataHandlers, (type = payload.type))
      ) {
        // set timer stamps
        payload.sent = new Date(payload.sent);
        payload.received = new Date(evt.timeStamp);
        // pass message to handler
        bridgeDataHandlers[type](bridge, payload.msg, payload, evt);
      }
    }

    // complete subetha initialization
    function onDomReady() {
      var
        clients = clientQueue,
        clientId;

      // set domReady flag
      domReady = 1;

      // alias body
      docBody = doc.body;

      // remove listeners
      unbind(scope, 'DOMContentLoaded', onDomReady);
      unbind(scope, 'load', onDomReady);

      // add client to resolved bridge
      addClient = function (client) {
        var
          networkId = client.network,
          bridge;

        // resolve bridge
        if (protoHas.call(bridges, networkId)) {
          bridge = bridges[networkId];
        } else {
          bridge = bridges[networkId] = new Bridge(networkId);
        }

        // add client to bridge
        bridge.addClient(client);
      };

      // remove client from bridge
      removeClient = function (client) {
        var bridge = client.bridge(privateKey);
        if (bridge) {
          bridge.removeClient(client);
        }
      };

      // dereference global queue then add all pending clients
      clientQueue = 0;
      for (clientId in clients) {
        addClient(clients[clientId]);
      }
    }

    function checkAndSendCustomEvent(clients, clientId, peerId, handler, data, msg, payload, evt) {
      var client;

      // this logic prevents a client from messaging itself
      if (
        // client exist
        protoHas.call(clients, clientId) &&
        // client has peer
        protoHas.call((client = clients[clientId]).peers, peerId)
      ) {
        handler(client, client.peers[peerId], data, msg, payload, evt);
      }
    }


    function setClientState(client, newState) {
      var oldState = client.state;

      // exit when not changing the state
      if (newState === oldState) {
        return;
      }

      // set new client state
      client.state = newState;
      // announce change
      client.fire('::readyStateChange', newState, oldState);

      // exit if the state was changed, after this event
      if (client.state !== newState) {
        return;
      }

      if (newState === STATE_INITIAL) {
        // clear peers
        client.peers = {};
        if (oldState > STATE_PENDING) {
          client.fire(DISCONNECT_EVENT);
        } else {
          client.fire('::closed');
        }
      }

      if (newState === STATE_READY) {
        client.fire(CONNECT_EVENT);
      }

      if (newState === STATE_CLOSING) {
        client.fire('::closing');
      }
    }

    function addPeerToClient(client, peerData) {
      // add peer to client if not the client
      client.peers[peerData.id] = new Peer(peerData, client);
    }


    function removeClientPeer(client, peerId) {
      var peers = client.peers;

      if (protoHas.call(peers, peerId)) {
        delete peers[peerId];
        client.fire(DROP_EVENT, peers[peerId]);
      }

    }

    function parseExchangeArgs(args) {
      var
        i = 0,
        el,
        elType,
        argLn = args.length,
        fnc,
        evts = [],
        exCfg = {
          // set as falsy now, for faster resolution
          cb:0
        };

      for (; i < argLn; i++) {
        el = args[i];
        elType = typeof el;
        if (el && elType === 'string') {
          evts[evts.length] = el;
        } else if (
          elType === 'function' &&
          !fnc &&
          i + 1 === argLn
        ) {
          exCfg.cb = fnc = el;
        } else {
          return 0;
        }
      }

      if (evts.length) {
        exCfg.chain = exchangeDelimiter + evts.join(exchangeDelimiter);
        return exCfg;
      }
    }

    function startExchange(client, args, peers) {
      var
        exchange,
        xid,
        type = args[0],
        thread,
        peerLn = peers.length;

      if (
        peerLn &&
        isFullString(type)
      ) {

        // exchange identifier
        xid = guid();

        // send exchange to peers
        // exit if send fails
        if (
          !client._transmit(
            'exchange',
            {
              xid: xid,
              idx: 0,
              type: type,
              params: protoSlice.call(arguments, 1)
            },
            peers
          )
        ) {
          return;
        }

        setUpExchange(client);
        exchange = client._ex.xids[xid] = {
          pids: {},
          cnt: peerLn
        };
        thread = exchangeDelimiter + type;
        // track exchange with each peer
        while (peerLn--) {
          exchange.pids[peers[peerLn]] = {
            thread: thread,
            idx: 0
          };
        }
        return xid;
      }
    }

    function AddThreadToPeerExchange(client, xid, pid, evt) {
      var
        exchange,
        peerExchange
      ;

      setUpExchange(client);

      if (protoHas.call(client._ex.xids, xid)) {
        exchange = client._ex.xids[xid];
      } else {
        exchange = client._ex.xids[xid] = {
          pids: {},
          cnt: 0
        };
      }
      if (protoHas.call(exchange.pids, pid)) {
        peerExchange = exchange.pids[pid];
      } else {
        peerExchange =
        exchange.pids[pid] =
          {
            thread: '',
            idx: -1
          };
        exchange.cnt++;
      }
      peerExchange.thread += exchangeDelimiter + evt;
      peerExchange.idx++;

      return exchange;
    }

    function setUpExchange(client) {
      if (!protoHas.call(client, '_ex')) {
        client._ex = {
          xids: {},
          chains: {}
        };
        // ensure all exchanges are exited properly before closing the connection
        client.on('::closing', tearDownExchange);
      }
    }

    function tearDownExchange() {
      var
        client = this,
        exchanges = client._ex.xids,
        xid
      ;

      delete client._ex;
      client.off('::closing', tearDownExchange);

      if (client.state > STATE_PENDING) {
        // for each active exchange
        for (xid in exchanges) {
          // end conversation with active peers
          client._transmit(
            'exchange',
            {
              xid: xid,
              xkill: 1
            },
            objectKeys(exchanges[xid].pids)
          );
        }
      }
    }

    function endExchange(client, xid, exchange) {
      delete client._ex[xid];
      // announce exchange is over, if it existed
      if (exchange) {
        client.fire('::endExchange', exchange.thread);
      }
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

    function Bridge(network) {
      var
        bridge = this,
        iframe = doc.createElement('iframe'),
        cipher = new Morus();

      bridge.iframe = iframe;
      bridge.id = network;
      bridge.cipher = cipher;
      bridge.clients = {};
      bridge.channels = {};
      bridge.channelCnts = {};
      // payload for first load
      bridge.ping = [
        // protocol version
        protocolVersion,
        // speaker key
        speakerKey,
        // bridge identifier
        network,
        // cipher initial index
        cipher.shift,
        // cipher substitution table
        JSONstringify(cipher.map)
      ].join('`');

      // if not already enabled, subscribe to events
      if (!bridgeCnt++) {
        bind(scope, 'message', bridgeRouter);
        bind(scope, 'unload', removeEthaDiv);
      }

      // scope iframe!onload handler to this instance
      bridge.onLoad = function () {
        bridgeOnLoadHandler(bridge);
      };

      bind(iframe, 'load', bridge.onLoad);

      if (network === defaultNetwork) {
        // generate bridge url
        iframe.src = 'javascript:\'<script src="../../morus/morus.min.js"></script><script src="' + subetha.bridgeScript + '"></script>\'';
      } else {
        // use url or default bridge
        iframe.src = network;
      }

      // give bridge time to connect
      bridge.dDay(subetha.bridgeDelay);

      // add bridge to ethadiv
      ethaDiv.appendChild(iframe);

      // ensure iframe is (now) in the dom
      if (!bridge.inDom()) {
        docBody.appendChild(ethaDiv);
      }

    }

    mix(Bridge.prototype, {

      // number of failed cipher decoding attempts
      failures: 0,

      // bridges start queued, since they are immediately added to the dom
      state: STATE_QUEUED,

      // number of clients
      cnt: 0,

      // add client to bridge
      addClient: function (client) {
        var
          bridge = this,
          clients = bridge.clients,
          clientId = client.id;

        // init new clients
        if (!protoHas.call(clients, clientId)) {
          // uptick tally
          bridge.cnt++;
          // expose bridge via closured method
          client.bridge = function (val) {
            return val === privateKey && bridge;
          };
          // add to client queue
          clients[clientId] = client;
        }

        // if bridge is ready now...
        if (bridge.state == STATE_READY) {
          // authenticate this client
          bridge.auth(client);
        }

      },

      // remove client from bridge, via client command
      removeClient: function (client) {
        var
          bridge = this,
          clientId = client.id,
          channelName = client.channel;

        // if other clients will remain
        if (--bridge.cnt) {
          // deference client
          delete bridge.clients[clientId];
          // when authed
          if (client.state > STATE_QUEUED) {
            // remove client from channel
            delete bridge.channels[channelName][clientId];
            // when this is the last client in the channel
            if (bridge.channelCnts[channelName]-- == 1) {
              delete bridge.channelCnts[channelName];
            }
          }

          // discard this one client
          bridge.drop(client);
        } else {
          // simply destroy the entire bridge
          bridge.destroy();
        }
      },

      // authenticate client (with network)
      auth: function (client) {
        // set client to pending
        setClientState(client, STATE_PENDING);
        // if still pending, then send client to bridge
        if (client.state == STATE_PENDING) {
          // authenticate client
          this.send('auth', {
            id: client.id,
            channel: client.channel,
            creds: client.creds(privateKey)
          });
        }
      },

      destroy: function () {
        var
          bridge = this,
          prevBridgeState = bridge.state,
          iframe = bridge.iframe,
          clients = bridge.clients,
          clientId;

        // kill any destruction timer
        bridge.dDay();

        // prevent clients from transmitting
        bridge.state = STATE_CLOSING;

        // dereference and close clients
        bridge.clients = {};
        bridge.cnt = 0;
        for (clientId in clients) {
          bridge.drop(clients[clientId]);
        }

        // exit if new clients were created
        if (bridge.cnt) {
          // restore bridge state
          bridge.state = prevBridgeState;
          // abort destruction
          return;
        }

        bridge.deref();

        // kill load listener for this bridge
        unbind(iframe, 'load', bridge.onLoad);

        // if this will be the last bridge
        if (!--bridgeCnt) {
          // stop listening for messages
          unbind(scope, 'message', bridgeRouter);
          // stop listening for unload
          unbind(scope, 'unload', removeEthaDiv);
          removeEthaDiv();
        }

        if (ethaDiv.contains(iframe)) {
          // remove bridge from ethadiv
          ethaDiv.removeChild(iframe);
        }
      },

      deref: function () {
        // dereference bridge to stop receiving messages
        delete bridges[this.id];
      },

      // remove client from bridge
      drop: function (client) {
        var clientState = client.state;

        // remove custom bridge method
        delete client.bridge;

        // for pending and ready clients...
        if (clientState > STATE_QUEUED && clientState < STATE_CLOSING) {

          // inform network of client departure
          this.send('drop', client.id);

          // clean up connections
          if (clientState == STATE_READY) {
            // tell client it's closing
            setClientState(client, STATE_CLOSING);
          }
        }

        // dereference all peers
        client.peers = {};

        // if client is still closing
        if (client.state == STATE_CLOSING) {
          // set client state (now)
          setClientState(client, STATE_INITIAL);
        }
      },

      // ensures an incoming message is valid
      decode: function (coded) {
        var
          bridge = this,
          cipher = bridge.cipher,
          data;

        // smell test before expensive try/catch
        if (
          // coded is a string
          isFullString(coded) &&
          // decodes
          (data = cipher.decode(coded)) &&
          // smells like a json object (due to random padding)
          r_jsonish.test(data)
        ) {
          // exit if data is not a json object
          try {
            data = JSONparse(data);
            // increment starting index (the iframe code has already done this)
            cipher.shift++;
            // return data object
            return data;
          } catch (e) {
            // silent exception
          }
        }

        // check failure tolerance
        if (++bridge.failures === 3) {
          // destroy bridge
          bridge.destroy();
        }

        // fail decoding
        return 0;
      },

      // specifies when bridge iframe is in the page ethadiv and dom
      inDom: function () {
        var iframe = this.iframe;

        return ethaDiv.contains(iframe) && docBody.contains(iframe);
      },

      // (dooms-day) wait before destroying bridge
      // stops timer when called without params
      dDay: function (ms) {
        var bridge = this;

        // stop current timebomb
        clearTimeout(bridge.timer);

        // start new timebomb
        if (ms) {
          bridge.timer = setTimeout(function () {
            bridge.destroy();
          }, ms);
        }
      },

      // send protocol message to bridge
      send: function (type, msg) {
        var
          bridge = this,
          msgId;

        // only send when ready
        if (bridge.state != STATE_READY) {
          return 0;
        }

        msgId = guid();
        postMessage(
          bridge.iframe.contentWindow,
          // protocol message
          {
            // key needed by bridge
            key: speakerKey,
            // message identifier
            mid: msgId,
            // type of message
            type: type,
            // message content
            msg: msg
          }
        );

        // return message id
        return msgId;
      }

    });


    function Client (channelNetwork) {
      var
        channel,
        network,
        pos,
        me = this,
        credentials = protoSlice.call(arguments, 1);

      // parse channelNetwork into channel and/or network
      if (isFullString(channelNetwork)) {
        pos = channelNetwork.indexOf('@');
        if (~pos) {
          channel = channelNetwork.substring(0, pos);
          network = channelNetwork.substring(pos + 1);
        } else {
          channel = channelNetwork;
        }

        // use given channel
        if (channel) {
          me.channel = channel;
        }

        // sanitize and use given network
        if (network) {
          if (r_domainish.test(network)) {
            // add protocol safe prefix, if network looks like a domain
            network = networkPrefix + network;
          }
          me.network = network;
        }
        me.peers = {};
      }

      // private creds method
      // sets network credentials
      me.creds = function (val) {
        if (val === privateKey) {
          return credentials;
        }
        credentials = protoSlice.call(arguments);
        return me;
      };
    }

    // extend EventEmitter
    Client.prototype = new EventEmitter();

    mix(Client.prototype, {

      id: '',

      network: defaultNetwork,

      channel: defaultChannel,

      // collection of client types this client can process
      /*
      handler signature
        1. receiving client instance
        2. sending peer instance
        3. data (in msg)
        4. msg (in payload)
        5. payload (decoded from event)
        6. native post-message event

      data structure
      {                           [payload]
        mid: <guid>,
        type: "client",
        sent: <date>,
        msg: {                    [msg]
          type: "event",
          from: <guid>,
          to: [<guid>, ...],
          data: <event-data>      [data] *optional
        }
      }
      */
      msgs: {

        // handle client event
        /*
        event-data structure
        {                       [data]
          name: <event-name>,
          args: [...]
        }
        */
        event: function (client, peer, data, msg, evt) {
          var
            args = data.args,
            eventName = data.name,
            cevt = {
              type: eventName,
              data: [].concat(args),
              id: msg.mid,
              peer: peer,
              sent: msg.sent,
              received: msg.received,
              timeStamp: evt.timeStamp
            };

          if (args.length) {
            client.fire.apply(client, [eventName, cevt].concat(args));
          } else {
            client.fire(eventName, cevt);
          }
        },

        // handle client exchange
        /*
        data structure
        {                       [data]
          type: "exchange",
          name: <event-name>,
          args: [...],
          xid: <exchange-id>,
          idx: <exchange-number>
        }
        */
        // exchange: function (client, peer, data, msg, payload, evt) {
        //   var
        //     cevt,
        //     xid = msg.xid,
        //     midx = msg.idx,
        //     exchanges = client._ex,
        //     exchange,
        //     chain = exchangeDelimiter + msg.type;

        //   //  process exchange when...
        //   if (
        //     // exchanges are registered
        //     exchanges &&
        //     // not an end message
        //     !msg.xkill && (
        //       // either...
        //       (
        //         // an active exchange exists, and
        //         (exchange = exchanges.xids[xid] && exchanges.xids[xid].pids[fromId]) &&
        //         // the index is as expected
        //         exchange.idx + 1 === midx &&
        //         // there is a response for this chain
        //         protoHas.call(exchanges.chains, exchange.thread + chain)
        //       ) ||
        //       (
        //         // there is no exchange and
        //         !exchange &&
        //         // the idx is as expected
        //         !midx &&
        //         // there is a response for this chain
        //         prtoHas(exchanges.chains, chain)
        //       )
        //     )
        //   ) {
        //     AddThreadToPeerExchange(client, xid, fromId, chain);

        //     exchange = client._ex.xids[xid].pids[fromId];
        //     cb = client._ex.chains[exchange.thread];
        //     // define custom event
        //     cevt = {
        //       peer: client.peers[fromId],
        //       type: exchange.thread,
        //       args: msg.args.concat(),
        //       end: function () {
        //         endExchange(xid, exchange, client);
        //       },
        //       reply: function () {
        //         if (exchange.idx === midx) {
        //           exchange.idx++;
        //           sendExchange(client, exchange, arguments);
        //         }
        //       }
        //     };

        //     client.fire('::exchange', client, cevt);

        //     if (msg.args.length) {
        //       cb.apply(client, [cevt].concat(msg.args));
        //     } else {
        //       cb.call(client, cevt);
        //     }

        //     // exit
        //     return;
        //   }

        //   // if not ordered to die
        //   if (!msg.xkill) {
        //     // tell peer to end this conversation
        //     client._transmit(
        //       'exchange',
        //       {xkill: 1},
        //       [fromId]
        //     );
        //   }
        //   // kill exchange on this client
        //   endExchange(xid, exchange, client);
        // }

      },

      creds: noOp,

      // connection state
      state: STATE_INITIAL,

      // returns closured bridge when connected and passed correct key
      bridge: function () {
        return false;
      },

      // broadcast custom event to peers
      send: function (name) {
        var args = arguments;

        return this._transmitEvent(
          name,
          args.length > 1 ? protoSlice.call(args, 1) : [],
          0
        );
      },

      // start conversation with each peer
      ask: function () {
        var client = this;

        return startExchange(client, arguments, objectKeys(client.peers)) || false;
      },

      // add callback for threaded event
      exchange: function () {
        var
          client = this,
          exCfg = parseExchangeArgs(arguments)
        ;

        // allow when config has a callback
        if (exCfg && exCfg.cb) {

          setUpExchange(client);

          client._ex.chains[exCfg.chain] = exCfg.cb;
        }

        return client;
      },

      // remove callback for a threaded event
      discard: function () {
        var
          client = this,
          exCfg,
          chains,
          chain,
          tgtChain;

        if (
          // exchange data exists
          protoHas.call(client, '_ex') &&
          // the provided arguments are valid
          (exCfg = parseExchangeArgs(arguments)) &&
          // the targeted chain exists (at least)
          protoHas.call(
            (chains = client._ex.chains),
            (tgtChain = exCfg.chain)
          )
        ) {
          // remove this and all ancestor chains
          for (chain in chains) {
            if (!chain.indexOf(tgtChain)) {
              delete chains[chain];
            }
          }
        }

        return client;
      },

      // add client to bridge queue
      open: function () {
        var
          args = arguments,
          me = this,
          state = me.state;

        if (state < STATE_PENDING && args.length) {
          // set bridge access credentials
          me.creds.apply(me, args);
        }

        // when initial
        if (state < STATE_QUEUED) {
          // set id now
          me.id = guid();
          // update state to queued
          setClientState(me, STATE_QUEUED);
          // if state hasn't changed since queuing (i.e., they haven't closed the client)
          if (me.state === STATE_QUEUED) {
            // add to global/bridge queue
            addClient(me);
          }
        }

        return me;
      },

      // remove from global/bridge queue
      close: function () {
        var
          client = this,
          state = client.state;

        if (state > STATE_INITIAL && state < STATE_CLOSING) {
          // remove from global queue or bridge
          removeClient(client);
        }

        return client;
      },

      // send arbitrary client event
      _transmit: function (type, data, peers) {
        var
          client = this,
          bridge = client.bridge(privateKey);

        if (
          bridge &&
          bridge.state === STATE_READY &&
          client.state === STATE_READY &&
          isFullString(type) &&
          (
            !peers ||
            isFullString(peers) ||
            (
              isArray(peers) &&
              peers.every(isFullString)
            )
          )
        ) {
          return bridge.send(
            'client',
            {
              type: type,
              from: client.id,
              to: peers ? [].concat(peers) : 0,
              data: data
            }
          );
        }

        return false;
      },

      // convenience method for sending custom events
      _transmitEvent: function (name, args, peers) {
        return !!isFullString(name) &&
          this._transmit(
            'event',
            {
              name: name,
              args: arguments.length > 1 ? [].concat(args) : []
            },
            peers ? [].concat(peers) : 0
          );
      }

    });

    function ClientEvent(client, fromId, msg) {
      this.peer = client.peers[fromId];
      this.type = msg.type;
    }

    mix(ClientEvent.prototype, {

    });

    // proxy for communicating with a specific peer
    function Peer(peerData, client) {
      var me = this;

      me.client = client;
      if (peerData) {
        me.id = peerData.id;
        me.origin = peerData.origin;
        me.start = new Date(peerData.start);
        me.channel = peerData.channel;
      }
    }

    mix(Peer.prototype, {

      // indicates peer is usable
      state: STATE_READY,

      // transmit event to this peer
      send: function (name) {
        var
          peer = this,
          args = arguments;

        // exit if peer is disabled
        if (!peer.state) {
          return false;
        }
        return peer.client._transmitEvent(
          name,
          args.length > 1 ? protoSlice.call(args, 1) : [],
          peer.id
        );
      },

      // begin exchange with this peer
      ask: function () {
        var
          peer = this,
          client = peer.client;

        return startExchange(client, arguments, [peer.id]) || false;
      }

    });


    // if there is no postMessage method
    if (typeof scope.postMessage !== 'function') {

      // deny all clients
      Client.prototype.open = function () {
        return this;
      };

    } else if (doc.body) {
      // perform dom ready stuff now
      onDomReady();
    } else {
      // wait for dom ready
      bind(scope, 'DOMContentLoaded', onDomReady);
      bind(scope, 'load', onDomReady);
    }

    return subetha;
  }

  // initialize and expose module, based on the environment
  if (inAMD) {
    define(initSubEtha);
  } else if (inCJS) {
    module.exports = initSubEtha();
  } else if (!scope.Subetha) {
    scope.Subetha = initSubEtha();
  }
}(
  typeof define === 'function',
  typeof exports != 'undefined',
  Array, Date, Math, JSON, Object, RegExp, this
);