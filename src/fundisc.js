const axios = require('axios');
const WebSocket = require('ws');
const {URLSearchParams} = require('url');

const gateway = async (api = 'https://discord.com/api') => {
  const {data: {url}} = await axios.get(`${api}/gateway`);
  return `${url}?${new URLSearchParams({v: 8, encoding: 'json'})}`;
};

const req = payload => Object.assign(function() {}, {
  payload: JSON.parse(payload)
});

const ended = Symbol('ended');
const res = (req, sendable) => Object.assign(function() {}, {
  end() {
    return ended;
  },
  req, sendable
});

const fundisc = () => Object.assign(function() {}, {
  use(...middlewares) {
    this.stack.push(middlewares);
    return this;
  },
  catch(...middlewares) {
    !this.sink && (this.sink = []);
    this.sink.push(middlewares);
    return this;
  },
  async connect(reqres, middlewares, error) {
    for (const middleware of middlewares) {
      if (await new Promise((resolve, reject) => {
        const args = [...reqres, thrown => thrown ? reject(thrown) : resolve()];

        error && args.unshift(error);

        return Promise.resolve(middleware(...args))
          .then(out => resolve(out)).catch(error => reject(error)) || resolve()
      }) === ended) {
        return ended;
      }
    }
  },
  async handle(payload, sendable) {
    const reqres = [req(payload), res(req, sendable)];

    try {
      for (const middlewares of this.stack) {
        if (await this.connect(reqres, middlewares) === ended) return;
      }
    } catch (error) {
      for (const middlewares of (this.sink || [[() => console.error(error)]])) {
        if (await this.connect(reqres, middlewares, error) === ended) return;
      }
    }
  },
  async listen(...args) {
    const sendable = args[0] ? await args[0]() : await gateway()
      .then(url => new WebSocket(url));
    const handle = payload => this.handle(payload, sendable);

    sendable.on('message', handle);
    sendable.on('ready', handle);

    return sendable;
  },
}, {
  stack: [],
  sink: undefined
});

const seq = handle => req => handle(req.payload.op === 1 ? req.payload.d : req.payload.seq);

exports.gateway = gateway;
exports.fundisc = fundisc;
exports.seq = seq;


/*const establish = async (sendable, options = {}) => {
  const cache = {seq: null, acked: true};
  const send = payload => sendable.send(JSON.stringify(payload));

  const handle = handler => payload => {
    const {op, d, s, t} = JSON.parse(payload);
    s && cache.seq = s;
    return handler(op, s, d, t);
  };

  const ops = {
    '1': seq => {
      cache.seq = seq;
    },
    '10': ({heartbeat_interval}) => {
      const beat = setInterval(() => {
        //!cache.acked && ();
        cache.acked && (cache.acked = false);
        send({op: 1, d: cache.seq});
      }, heartbeat_interval);
      send({op: 2, d: identify});
    },
    '11': () => {
      cache.acked = true;
    }
  };

  sendable.on('error', payload => {
    console.log(payload);
  });

  sendable.on('ready', payload => {
    console.log(payload);
  });

  sendable.on('message', payload => {
    console.log(payload);
    const {op, d, s} = JSON.parse(payload);
    !ops[String(op)] && return console.warn(`unsupported op ${op} received`);
    ops[String(op)](d);
  });
};


(async () => {
  const url = await gateway();
  await establish(() => new WebSocket(url), {
    token: 'NzUyNjM4NTMxOTcyODkwNzI2.X1ajQQ.XAYGetHdZhhrve_sY37LEYkuRIE',
    intents: (1 << 10) | (1 << 9),
  });
})();*/
