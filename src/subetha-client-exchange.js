/*!
 * SubEtha-Client-Exchange v0.0.0
 * http://github.com/bemson/subetha/
 *
 * Copyright, Bemi Faison
 * Released under the MIT License
 */
/* global define, require */
!function (inAMD, inCJS, Array, Date, Math, JSON, Object, RegExp, scope, undefined) {

  function initSubEthaExchange() {

    var
      subetha = ((inCJS || inAMD) ? require('subetha') : scope.Subetha),
      guid = subetha.guid,
      Client = subetha.Client,
      Peer = subetha.Peer,
      states = subetha.states,
      chainPrefix = '=',
      protoSlice = Array.prototype.slice,
      protoHas = Object.prototype.hasOwnProperty,
      DISCONNECT_EVENT = '::disconnect',
      ENDEXCHANGE_EVENT = '::endExchange',
      EXCHANGE_EVENT = '::exchange'
    ;

    // Utility

    function objKeys(obj) {
      var
        ary = [],
        key;

      for (key in obj) {
        ary.push(key);
      }
      return ary;
    }

    // Functions

    function startExchange(client, args, pid) {
      var
        xid,
        type = args[0],
        peers,
        peersLn;

      if (!type || typeof type != 'string') {
        return false;
      }

      if (pid) {
        // converse with the given peer
        peers = [pid];
      } else {
        // converse with all peers
        peers = objKeys(client.peers);
      }
      peersLn = peers.length;

      if (!peersLn) {
        // exit if no peers
        return;
      }

      // create exchange identifier
      xid = guid();

      // exit if can't start convo
      if (!sendExchange( client, xid, pid, 0, type, args.length ? protoSlice.call(args, 1) : [] )) {
        return false;
      }

      // track exchange with each message to peer
      while (peersLn--) {
        setupExchange(client, xid, peers[peersLn]).push(type);
      }

      return xid;
    }

    function setupExchange(client, xid, pid) {
      var
        pids,
        result;

      // init client
      if (!protoHas.call(client, '_ex')) {
        result =
        client._ex =
          {
            // active exchanges
            xids: {},
            // exchange callbacks
            cbs: {}
          };
        // ensure all exchanges are properly closed when the client disconnects
        client.on(DISCONNECT_EVENT, destroyClient);
      }

      // add tracker for this exchange
      if (xid && !protoHas.call(client._ex.xids, xid)) {
        result =
        client._ex.xids[xid] =
          {
            pids: {},
            cnt: 0
          };
      }

      // start chain for the given peer - if any
      if (pid && !protoHas.call(client._ex.xids[xid].pids, pid)) {
        client._ex.xids[xid].cnt++;
        pids = [];
        // shared function to end this exchange
        pids.endFn = function () {
          return !!endExchange(client, xid, pid);
        };
        result =
        client._ex.xids[xid].pids[pid] =
          pids;
      }

      return result;
    }

    function sendExchange(client, xid, pid, idx, type, data) {
      return client._transmit('exchange',
        {
          // identifier
          xid: xid,
          // starting index
          idx: idx,
          // first type
          type: type,
          // args
          data: data
        },
        pid
      );
    }


    function destroyClient() {
      var
        me = this,
        exchanges = me._ex.xids,
        xid;

      // remove listener
      me.off(DISCONNECT_EVENT, destroyClient);

      // end current exchanges
      for (xid in exchanges) {
        // tell self the exchange ended
        removePeerExchange(me, xid, exchanges[xid], 1);
      }

      // clean up
      delete me._ex;
    }

    function removePeerExchange(client, xid, pid) {
      var
        exchanges,
        exchange,
        peerExchange;

      if (!protoHas.call(client, '_ex')) {
        // exit if there is no exchange for this peer
        return;
      }

      // alias this exchange
      exchanges = client._ex.xids;
      exchange = exchanges[xid];

      // if there is no peerExchange
      if (
        !exchange ||
        !protoHas.call(exchange.pids, pid)
      ) {
        return;
      }

      // alias the exchange with this peer
      peerExchange = exchange.pids[pid];
      // delete peer exchange
      delete exchange.pids[pid];
      // remove entire exchange if this was the last peer
      if (!--exchange.cnt) {
        delete exchanges[xid];
      }
      // inform client that this exchange has ended
      fireEndExchangeEvent(client.peers[pid], peerExchange);
      return 1;
    }

    function fireEndExchangeEvent(peer, chain) {
      peer._client.fire(ENDEXCHANGE_EVENT, peer, chain.concat());
    }

    function endExchange(client, xid, pid) {
      killExchange(client, xid, pid);
      removePeerExchange(client, xid, pid);
    }

    function killExchange(client, xid, pid) {
      // end exchange with given peer(s)
      return client._transmit(
        'exchange',
        {
          xid: xid,
          xkill: 1
        },
        pid
      );
    }

    // Classes

    // add callback for message chain
    Client.prototype.adhoc = function () {
      var
        me = this,
        args = arguments,
        cb = args[args.length - 1];

      if (
        args.length < 2 ||
        typeof cb != 'function'
      ) {
        return false;
      }

      setupExchange(me);
      me._ex.cbs[chainPrefix + protoSlice.call(args, 0, -1).join()] = cb;
      return true;
    };

    // remove callback for message chain
    Client.prototype.unhoc = function () {
      var
        me = this,
        args,
        chain,
        cbs,
        cbKey,
        result = false;

      if (protoHas.call(me, '_ex')) {

        args = protoSlice.call(arguments);

        if (typeof args[args.length - 1] == 'function') {
          // remove last arg when it's a function
          args = args.slice(0, -1);
        }

        // get target key
        chain = chainPrefix + args.join();
        chainRxp = new RegExp('^' + chain);
        // alias callbacks
        cbs = me._ex.cbs;

        // prune all chains prefixed with this regexp
        for (cbKey in cbs) {
          if (chainRxp.test(cbKey)) {
            result = true;
            delete cbs[cbKey];
          }
        }
      }
      return result;
    };

    Client.prototype.ask = function () {
      return startExchange(this, arguments);
    };

    Peer.prototype.ask = function () {
      var me = this;

      return startExchange(me._client, arguments, me.id);
    };

    // end all exchanges that began with the given type or have the given id
    Peer.prototype.endExchange = function (xref) {
      var
        me = this,
        peerId = me.id,
        client = me._client,
        exchanges = me._ex,
        result = false,
        isId,
        xid;

      if (exchanges) {
        for (xid in exchanges) {
          isId = xid == xref;
          if (
            // matched the exchange id
            isId ||
            // matches the first msg in this exchange
            exchanges[xid].chain[0] == xref
          ) {
            endExchange(client, peerId, xid);
            result = true;
            if (isId) {
              break;
            }
          }
        }
      }

      return result;
    };

    Client.msgs.exchange = function (client, peer, data, msg, payload, customEvent) {
      var
        xid = data.xid,
        pid = peer.id,
        midx,
        exchanges,
        peerExchange,
        type,
        chain;

      // exit when no exchanges are registered - i.e., this client can't host a conversation
      if (!protoHas.call(client, '_ex')) {
        endExchange(client, xid, pid);
        return;
      }

      // exit when told to end exchange
      if (protoHas.call(data, 'xkill')) {
        // discard tracker for exchange with this peer
        removePeerExchange(client, xid, pid);
        return;
      }


      setupExchange(client, xid, pid);
      exchanges = client._ex;
      type = data.type;
      midx = data.idx;
      peerExchange = exchanges.xids[xid].pids[pid];
      chain = chainPrefix + peerExchange.concat(type).join();

      // end convo when...
      if (
        // there is no callback for this chain, or...
        !protoHas.call(exchanges.cbs, chain) ||
        // the index is invalid
        peerExchange.length != midx
      ) {
        endExchange(client, xid, pid);
        return;
      }

      // add type to peer exchange
      peerExchange.push(type);

      // add exchange id
      customEvent.exchange = xid;
      // allow ending this conversation at anytime
      customEvent.end = peerExchange.endFn;
      // allow replying once to this exchange
      customEvent.reply = function () {
        var
          args,
          type;

        if (protoHas.call(exchanges.xids, xid) && peerExchange.length == midx + 1) {
          args = arguments;
          type = args[0];
          // add reply to this conversation
          peerExchange.push(type);
          // send reply to peer
          return sendExchange(client, xid, pid, midx + 1, type, protoSlice.call(args, 1));
        }
        return false;
      };
      // expose chain
      customEvent.thread = peerExchange.concat();

      // acknowledge exchange event
      client.fire(EXCHANGE_EVENT, customEvent, client.peers[pid]);

      // if the callback is still here...
      if (protoHas.call(exchanges.cbs, chain)) {
        // get exchange callback
        cb = exchanges.cbs[chain];

        if (data.data.length) {
          cb.apply(client, [customEvent].concat(data.data));
        } else {
          cb.call(client, customEvent);
        }
      } else {
        // die without a callback
        endExchange(client, xid, pid);
      }

    };

    // flag that this plugin was initialized
    // is this namespacing for browser extensions
    subetha._ex = true;

    return subetha;
  }

  // initialize and expose module, based on the environment
  if (inAMD) {
    define(initSubEthaExchange);
  } else if (inCJS) {
    module.exports = initSubEthaExchange();
  } else if (scope.Subetha) {
    // tack on to existing namespace
    scope.Subetha = initSubEthaExchange();
  }
}(
  typeof define === 'function',
  typeof exports != 'undefined',
  Array, Date, Math, JSON, Object, RegExp, this
);