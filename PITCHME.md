# SubEtha:
## Domain-Free Events
### (It's just a pipe!) <!-- .element: class="fragment" -->
---

# Who Am I?

Bemi Faison <br>
bemson@gmail.com <br>
github.com/bemson

---

# What's an Event?

An "event" is a message between systems. <!-- .element: class="fragment" -->

The "system" could be anything: <!-- .element: class="fragment" -->

  * Browsers to JavaScript <!-- .element: class="fragment" -->
  * Objects to objects <!-- .element: class="fragment" -->
  * Clients to servers (e.g., xhrs) <!-- .element: class="fragment" -->

---

# What's a Domain?

A _domain_ is where your events occur.

Withstanding sub-domains, there's only one per website. <!-- .element: class="fragment" -->

---

# Events are Domain-Bound

Within a single application, it's implied that events are how our code talks to itself.

---

# When Domains Collaborate

When data is accessible across accounts, users gain a more seamless web experience.

> "My peanut-butter.com account would work great with my jelly.com data! Or, I could put them together on bread.com!"

---

# Cross-Domain Options Exist

---

# Servers have many

  * REST
  * oAuth
  * RPC (ugh)
  * curl, ftp, gopher, etc...

---

# Clients have few

  * postMessage

---

# postMessage is hard

Example syntax:

```
window.postMessage('Hello!', 'otherdomain.com');
```
<!-- .element: class="fragment" -->
 * Requires a window reference <!-- .element: class="fragment" -->
 * Heavy code coordination

---

# Why so serious?

Browsers have defensive same-origin policies that protect client and server communication. This is a _good_ thing.

Otherwise, free access between browser windows means free access between servers. That would be a _bad_ thing.

---

# What if clients had more?

Users could encounter less friction from sharing data.

> "Yes! My bread.com account automatically pulled _data_ from my peanut-butter.com and jelly.com accounts.

---

# Introducing [SubEtha](https://github.com/bemson/subetha)

---

# Also known as...

> An interstellar faster-than-light telecommunications network used by hitchhikers to flag down passing spaceships.
> - [Hitchhiker's Guide to the Galaxy, on wikipedia.org](https://en.wikipedia.org/wiki/Technology_in_The_Hitchhiker%27s_Guide_to_the_Galaxy#Sub-Etha)

(Thanks Douglas Adams!)

---

# Project goals

  * Focus on the event, not the window
  * Intrinsic security (e.g., build atop SOP)
  * Easier than postMessage
  * Robust publish/subscribe API

---

# Quick Nod

Met with [William Kapke-Wicks](https://github.com/williamkapke/), at [Oakland's JavaScript meetup](http://oaklandjs.com/), who created [scomm](https://github.com/williamwicks/scomm) and shared the original concept.

---

# Architecture

SubEtha uses a _bridge_ to relay events amongst windows - an iframe, pointing to a shared domain.

Each bridge observes and creates _localStorage events_ to stay in sync.

Web pages communicate across bridges with _clients_, subscribed to the same arbitrary channel - similar to Slack and irc.

---

# Getting Started

```
var client = new Subetha.Client();

client
  .on('::connect', function () {
    client.emit('hello world!');
  })
  .on('hello world!', function (e) {
    e.peer.send('welcome!');
  })
  .open('lobby');
```

---

# Demos :-)

* [Window Visualizer](http://rawgit.com/bemson/subetha-client-wi/master/wi_demo_visualizer.html)
* Red Ball on [jsbin.com](https://output.jsbin.com/lixikex), [rawgit.com](https://rawgit.com/bryclee/subetha-client-wi/master/wi_demo_visualizer.html), and [heroku](https://vast-garden-18526.herokuapp.com/) (Thanks to [Bryan Lee](https://github.com/bryclee)!)

_As of this presentation, the demos only work in Firefox..._ :-\\

---

# WAT?
## Adhoc Collaboration?

---

# Is this solution looking for a problem?
### (Yes.) <!-- .element: class="fragment" -->

---

# Cater to the user

 * Share data between active windows (saving bandwidth) <!-- .element: class="fragment" -->
 * Flight websites could know where you're going when they load <!-- .element: class="fragment" -->
 * News sites notice if you're into sports or politics <!-- .element: class="fragment" -->
 * Social sites ask if you wanna broadcast a post <!-- .element: class="fragment" -->
 * One, floating shopping cart for all your shopping

---

# Let's talk Security

SubEtha uses a MessageChannel to communicate with the bridge, directly. <!-- .element: class="fragment" -->

Bridges are (trusted) third party arbiters with control over whom joins a channel and the messages exchanged. <!-- .element: class="fragment" -->

Clients can only receive and send known event types.

---

# Technical Pivots

 * Started with localStorage events...
 * Ending at [(shared) web-workers and IndexedDB](https://github.com/bemson/subetha-bridge/issues/5) <!-- .element: class="fragment" -->
 * Focus on eventual consistency, rather than latency <!-- .element: class="fragment" -->
 * Fluctuating browser support <!-- .element: class="fragment" -->

See the gruesome details and [lengthy discussion](https://github.com/bemson/subetha-bridge/issues/1), with [Dmitry Utkin](https://github.com/gothy), [Tom Jacques](https://github.com/tejacques) and [Vitaly Puzrin](https://github.com/puzrin).

---

# Final Notes
<!-- .element: class="fragment" -->
 * SubEtha is an abandoned alpha project.  <!-- .element: class="fragment" -->
 * Updates are planned, but it's future is unclear. (The demo used to work in Chrome!) <!-- .element: class="fragment" -->
<!-- .element: class="fragment" -->
As with any external communication: **Only send want to share!**

---

# Questions?
