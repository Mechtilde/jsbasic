//
// Applesoft BASIC in Javascript
// BASIC Compiler
//

// Copyright (C) 2009-2011 Joshua Bell
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// API:
//    var program = basic.compile(source);
//    // may throw basic.ParseError
//
//    program.init({tty: ..., hires: .e.., lores: ...})
//
//    // if TTY input is blocking:
//
//    var state;
//    do {
//        state = program.step();
//        // may throw basic.RuntimeError
//    } while (state !== basic.STATE_STOPPED);
//
//    // if TTY input is non-blocking:
//    function driver() {
//        var state;
//        do {
//            state = program.step(driver);
//            // may throw basic.RuntimeError
//        } while (state === basic.STATE_RUNNING);
//    }
//    driver(); // step until done or blocked
//    // driver will also be called after input is unblocked
//    // driver may want to yield via setTimeout() after N steps

// Functions from polyfill.js, via jsmin, for running via console
if(!Object.keys){Object.keys=function(o){if(o!==Object(o))throw new TypeError();var ret=[],p;for(p in o)if(Object.prototype.hasOwnProperty.call(o,p))ret.push(p);return ret;};}
if(!Array.prototype.forEach){Array.prototype.forEach=function(fun){if(this===void 0||this===null){throw new TypeError();}var t=Object(this);var len=t.length>>>0;if(typeof fun!=="function"){throw new TypeError();}var thisp=arguments[1],i;for(i=0;i<len;i++){if(i in t){fun.call(thisp,t[i],i,t);}}};}
if(!Array.prototype.map){Array.prototype.map=function(fun){if(this===void 0||this===null){throw new TypeError();}var t=Object(this);var len=t.length>>>0;if(typeof fun!=="function"){throw new TypeError();}var res=[];res.length=len;var thisp=arguments[1],i;for(i=0;i<len;i++){if(i in t){res[i]=fun.call(thisp,t[i],i,t);}}return res;};}
if(!Array.prototype.reduce){Array.prototype.reduce=function(fun){if(this===void 0||this===null){throw new TypeError();}var t=Object(this);var len=t.length>>>0;if(typeof fun!=="function"){throw new TypeError();}if(len===0&&arguments.length===1){throw new TypeError();}var k=0;var accumulator;if(arguments.length>=2){accumulator=arguments[1];}else{do{if(k in t){accumulator=t[k++];break;}if(++k>=len){throw new TypeError();}}while(true);}while(k<len){if(k in t){accumulator=fun.call(undefined,accumulator,t[k],k,t);}k++;}return accumulator;};}
// Functions from harmony.js, via jsmin, for running via console
if(!String.prototype.repeat){String.prototype.repeat=function(count){var array=[];array.length=count+1;return array.join(String(this));};}

/*global window, java*/
var basic = (function() {
  /*jslint bitwise: false, onevar:false*/
  function unused() { } // explicitly mark unused parameters (for jslint)

  var basic = {
    STATE_STOPPED: 0,
    STATE_RUNNING: 1,
    STATE_BLOCKED: 2
  };

  //
  // Thrown if parsing fails
  //
  basic.ParseError = function(msg, line, column) {
    this.name = 'ParseError';
    this.message = msg || '';
    this.line = line;
    this.column = column;
  };
  basic.ParseError.prototype = new Error();


  //
  // Thrown when a program is running; can be caught by ONERR
  //
  basic.RuntimeError = function(msg, code) {
    this.name = 'RuntimeError';
    this.message = msg;
    this.code = code;
  };
  basic.RuntimeError.prototype = new Error();

  function runtime_error(msg) {
    if (typeof msg === 'object' && msg.length && msg.length >= 2) {
      throw new basic.RuntimeError(msg[1], msg[0]);
    } else {
      throw new basic.RuntimeError(msg);
    }
  }

  var ERRORS = {
    NEXT_WITHOUT_FOR: [0, "Next without for"],
    SYNTAX_ERROR: [16, "Syntax error"],
    RETURN_WITHOUT_GOSUB: [22, "Return without gosub"],
    OUT_OF_DATA: [42, "Out of data"],
    ILLEGAL_QUANTITY: [53, "Illegal quantity"],
    OVERFLOW: [69, "Overflow"],
    OUT_OF_MEMORY: [77, "Out of memory"],
    UNDEFINED_STATEMENT: [90, "Undefined statement"],
    BAD_SUBSCRIPT: [107, "Bad subscript"],
    REDIMED_ARRAY: [120, "Redimensioned array"],
    DIVISION_BY_ZERO: [133, "Division by zero"],
    TYPE_MISMATCH: [163, "Type mismatch"],
    STRING_TOO_LONG: [176, "String too long"],
    FORMULA_TOO_COMPLEX: [191, "Formula too complex"],
    UNDEFINED_FUNCTION: [224, "Undefined function"],
    REENTER: [254, "Re-enter"],
    INTERRUPT: [255, "Break"]
  };

  //
  // Runtime flow control
  //
  function EndProgram() { }
  function GoToLine(n) { this.line = n; }
  function NextLine() { }
  function BlockingInput(method, callback) {
    this.method = method;
    this.callback = callback;
  }



  // Adapted from:
  // http://stackoverflow.com/questions/424292/how-to-create-my-own-javascript-random-number-generator-that-i-can-also-set-the-s
  function PRNG() {
    var S = 2345678901, // seed
        A = 48271, // const
        M = 2147483647, // const
        Q = M / A, // const
        R = M % A; // const

    this.next = function PRNG_next() {
      var hi = S / Q,
          lo = S % Q,
          t = A * lo - R * hi;
      S = (t > 0) ? t : t + M;
      this.last = S / M;
      return this.last;
    };
    this.seed = function PRNG_seed(x) {
      S = Math.floor(Math.abs(x));
    };
    this.next();
  }

  // Multidimensional array, with auto-dimensioning on first access
  function BASICArray(type, dims) {

    var array, dimensions;

    function offset(dims, subscripts) {
      if (subscripts.length !== dimensions.length) {
        runtime_error(ERRORS.BAD_SUBSCRIPT);
      }

      var k, l, s = 0, p, ss;
      for (k = 0; k < dims.length; k += 1) {

        ss = subscripts[k];
        if (ss < 0) {
          runtime_error(ERRORS.ILLEGAL_QUANTITY);
        }
        ss = ss >> 0;
        if (ss >= dims[k]) {
          runtime_error(ERRORS.BAD_SUBSCRIPT);
        }

        p = 1;
        for (l = k + 1; l < dims.length; l += 1) {
          p *= dims[l];
        }
        s += p * ss;
      }
      return s;
    }

    this.dim = function dim(dims) {
      if (array) {
        runtime_error(ERRORS.REDIMED_ARRAY);
      }

      dimensions = dims.map(function(n) { return (Number(n) >> 0) + 1; });

      var i, len = dimensions.reduce(function(a, b) { return a * b; }),
                defval = (type === 'string') ? '' : 0;

      array = [];
      for (i = 0; i < len; i += 1) {
        array[i] = defval;
      }
    };

    this.get = function _get(subscripts) {
      if (!array) {
        this.dim(subscripts.map(function() { return 10; }));
      }


      return array[offset(dimensions, subscripts)];
    };

    this.set = function _set(subscripts, value) {
      if (!array) {
        this.dim(subscripts.map(function() { return 10; }));
      }

      array[offset(dimensions, subscripts)] = value;
    };

    this.toJSON = function toJSON() {
      return { type: type, dimensions: dimensions, array: array };
    };

    if (dims) {
      this.dim(dims);
    }
  }

  // Stream API, for parsing source and INPUT entry
  function Stream(string) {
    this.line = 0;
    this.column = 0;

    this.match = function match(re) {
      var m = string.match(re), lines;
      if (m) {
        string = string.substring(m[0].length);
        lines = m[0].split('\n');
        if (lines.length > 1) {
          this.line += lines.length - 1;
          this.column = lines[lines.length - 1].length;
        } else {
          this.column += m[0].length;
        }

        this.lastMatch = m;
        return m;
      }
      return (void 0);
    };

    this.eof = function eof() {
      return string.length === 0;
    };
  }

  // Used for DATA (compile-time) and INPUT (runtime)
  // Parses source string for optionally quoted, comma-
  // separated values and adds them to items. Returns
  // the substring consumed.
  var parseDataInput = (function() {

    var regexWhitespace = new RegExp('^[ \\t]+'),
            regexQuotedString = new RegExp('^"([^"]*?)"'),
            regexUnquotedString = new RegExp('^([^:,\\r\\n]*)'),
            regexComma = new RegExp('^,');

    return function _parseDataInput(stream, items) {

      do {
        stream.match(regexWhitespace);

        if (stream.match(regexQuotedString)) {
          // quoted string
          items.push(stream.lastMatch[1]);
        } else if (stream.match(regexUnquotedString)) {
          // unquoted string
          items.push(stream.lastMatch[1]);
        }
      } while (stream.match(regexComma));
    };
  } ());


  basic.compile = function _compile(source) {
    "use strict";
    /*jslint continue: true*/ // for readability

    function vartype(name) {
      var s = name.charAt(name.length - 1);
      return s === '$' ? 'string' : s === '%' ? 'int' : 'float';
    }

    //----------------------------------------------------------------------
    //
    // Runtime Environment (bound to compiled program)
    //
    //----------------------------------------------------------------------

    var env,        // Environment - passed in to program, contains tty, graphics, etc.
            state,      // Program state - initialized at runtime
            lib,        // Statement Library (closure over state and env)
            funlib,     // Function Library (closure over state and env)
            peek_table, // Native memory access shims (PEEK, POKE, CALL)
            poke_table,
            call_table;

    //
    // NOTE: tempting to make these part of env but some access/modify program state,
    // e.g. onerr
    //
    peek_table = {
      // Text window
      0x0020: function() { return env.tty.textWindow ? env.tty.textWindow.left : 0; },
      0x0021: function() { return env.tty.textWindow ? env.tty.textWindow.width : 80; },
      0x0022: function() { return env.tty.textWindow ? env.tty.textWindow.top : 0; },
      0x0023: function() { return env.tty.textWindow ? env.tty.textWindow.top + env.tty.textWindow.height : 24; },
      0x0024: function() { return env.tty.getCursorPosition().x; },
      0x0025: function() { return env.tty.getCursorPosition().y; },

      // Random number field
      0x004e: function() { return (Math.random() * 256) & 0xff; },
      0x004f: function() { return (Math.random() * 256) & 0xff; },

      // Last error code
      0x00de: function() { return state.onerr_code; },

      // Hires Plotting Page (32=1, 64=2, 96=3)
      0x00e6: function() { return env.display ? (env.display.hires_plotting_page === 2 ? 64 : 32) : 0; },

      // TODO: 0x3D0 = 0x4C if DOS is present.

      // Keyboard
      0xC000: function() { return env.tty.getKeyboardRegister ? env.tty.getKeyboardRegister() : 0; },
      0xC010: function() { return env.tty.clearKeyboardStrobe ? env.tty.clearKeyboardStrobe() : 0; },

      // Speaker toggle
      0xC030: function() { return 0; },

      // Buttons
      0xC060: function() { return env.tty.getButtonState ? env.tty.getButtonState(3) : 0; },
      0xC061: function() { return env.tty.getButtonState ? env.tty.getButtonState(0) : 0; },
      0xC062: function() { return env.tty.getButtonState ? env.tty.getButtonState(1) : 0; },
      0xC063: function() { return env.tty.getButtonState ? env.tty.getButtonState(2) : 0; }
    };

    poke_table = {
      // Text window
      0x0020: function(v) { if (env.tty.textWindow) { env.tty.textWindow.left = v; } },
      0x0021: function(v) { if (env.tty.textWindow) { env.tty.textWindow.width = v; } },
      0x0022: function(v) { if (env.tty.textWindow) { env.tty.textWindow.top = v; } },
      0x0023: function(v) { if (env.tty.textWindow) { env.tty.textWindow.height = v - env.tty.textWindow.top; } },
      0x0024: function(v) { env.tty.setCursorPosition(v, void 0); },
      0x0025: function(v) { env.tty.setCursorPosition(void 0, v); },

      // ONERR flag
      0x00D8: function(v) { if (v < 0x80) { state.onerr_handler = (void 0); } },

      // Hires Plotting Page (32=1, 64=2, 96=3)
      0x00E6: function(v) { if (env.display) { env.display.hires_plotting_page = (v === 64 ? 2 : 1); } },

      // Keyboard strobe
      0xC010: function(v) { unused(v); if (env.tty.clearKeyboardStrobe) { env.tty.clearKeyboardStrobe(); } },

      // Display switches
      0xC050: function(v) { unused(v); if (env.display) { env.display.setState("graphics", true); } }, // Graphics
      0xC051: function(v) { unused(v); if (env.display) { env.display.setState("graphics", false); } }, // Text
      0xC052: function(v) { unused(v); if (env.display) { env.display.setState("full", true); } }, // Full Graphics
      0xC053: function(v) { unused(v); if (env.display) { env.display.setState("full", false); } }, // Split Screen
      0xC054: function(v) { unused(v); if (env.display) { env.display.setState("page1", true); } }, // Page 1
      0xC055: function(v) { unused(v); if (env.display) { env.display.setState("page1", false); } }, // Page 2
      0xC056: function(v) { unused(v); if (env.display) { env.display.setState("lores", true); } }, // Lo-Res
      0xC057: function(v) { unused(v); if (env.display) { env.display.setState("lores", false); } }, // Hi-Res

      // Speaker toggle
      0xC030: function(v) { unused(v); } // no-op
    };

    call_table = {
      0xF3E4: function() { // Reveal hi-res page 1
        if (!env.hires) { runtime_error('Hires graphics not supported'); }
        env.display.setState('graphics', true, 'full', true, 'page1', true, 'lores', false);
      },
      0xF3F2: function() { // Clear hi-res screen to black
        var hires = env.display.hires_plotting_page === 2 ? env.hires2 : env.hires;
        if (!hires) { runtime_error('Hires graphics not supported'); }
        hires.clear();
      },
      0xF3F6: function() { // Clear hi-res screen to last color Hplotted
        var hires = env.display.hires_plotting_page === 2 ? env.hires2 : env.hires;
        if (!hires) { runtime_error('Hires graphics not supported'); }
        hires.clear(hires.color);
      },
      0xD683: function() { // Clear stack
        state.stack = [];
      },
      0xFC9C: function() { // Clear from cursor to right
        if (env.tty.clearEOL) { env.tty.clearEOL(); }
      }
    };

    lib = {

      //////////////////////////////////////////////////////////////////////
      //
      // Variable Statements
      //
      //////////////////////////////////////////////////////////////////////

      'clear': function CLEAR() {
        state.clear();
      },

      'dim': function DIM(name, subscripts) {
        state.arrays[name].dim(subscripts);
      },

      'def': function DEF(name, func) {
        state.functions[name] = func;
      },

      //////////////////////////////////////////////////////////////////////
      //
      // Flow Control Statements
      //
      //////////////////////////////////////////////////////////////////////

      'goto': function GOTO(line) {
        throw new GoToLine(line);
      },

      'on_goto': function ON_GOTO(index, line1, line2 /* ... */) {
        unused(line1, line2);
        index = (index - 1) >> 0;
        var lines = Array.prototype.slice.call(arguments, 1);

        if (index < 0 || index >= lines.length) {
          runtime_error(ERRORS.ILLEGAL_QUANTITY);
        }
        throw new GoToLine(lines[index]);
      },

      'gosub': function GOSUB(line) {
        state.stack.push({
          gosub_return: state.stmt_index,
          line_number: state.line_number
        });
        throw new GoToLine(line);
      },

      'on_gosub': function ON_GOSUB(index, line1, line2 /* ... */) {
        unused(line1, line2);
        index = (index - 1) >> 0;
        var lines = Array.prototype.slice.call(arguments, 1);
        if (index < 0 || index >= lines.length) {
          runtime_error(ERRORS.ILLEGAL_QUANTITY);
        }
        state.stack.push({
          gosub_return: state.stmt_index,
          line_number: state.line_number
        });
        throw new GoToLine(lines[index]);
      },

      'return': function RETURN() {
        var stack_record;
        while (state.stack.length) {
          stack_record = state.stack.pop();
          if ({}.hasOwnProperty.call(stack_record, 'gosub_return')) {
            state.stmt_index = stack_record.gosub_return;
            state.line_number = stack_record.line_number;
            return;
          }
        }
        runtime_error(ERRORS.RETURN_WITHOUT_GOSUB);
      },

      'pop': function POP() {
        var stack_record;
        while (state.stack.length) {
          stack_record = state.stack.pop();
          if ({}.hasOwnProperty.call(stack_record, 'gosub_return')) {
            return;
          }
        }
        runtime_error(ERRORS.RETURN_WITHOUT_GOSUB);
      },

      'for': function FOR(varname, from, to, step) {
        state.variables[varname] = from;
        state.stack.push({
          index: varname,
          from: from,
          to: to,
          step: step,
          for_next: state.stmt_index,
          line_number: state.line_number
        });
      },

      'next': function NEXT(var1, var2 /* ... */) {
        unused(var1, var2);

        var varnames = Array.prototype.slice.call(arguments),
                    varname, stack_record, value;
        do {
          varname = varnames.shift();

          do {
            stack_record = state.stack.pop();
            if (!stack_record || !{}.hasOwnProperty.call(stack_record, 'for_next')) {
              runtime_error(ERRORS.NEXT_WITHOUT_FOR);
            }
          } while (varname !== (void 0) && stack_record.index !== varname);

          value = state.variables[stack_record.index];

          value = value + stack_record.step;
          state.variables[stack_record.index] = value;

          if (!(stack_record.step > 0 && value > stack_record.to) &&
                        !(stack_record.step < 0 && value < stack_record.to) &&
                        !(stack_record.step === 0 && value === stack_record.to)) {
            state.stack.push(stack_record);
            state.stmt_index = stack_record.for_next;
            state.line_number = stack_record.line_number;
            return;
          }
        } while (varnames.length);
      },

      'if': function IF(value) {
        if (!value) {
          throw new NextLine();
        }
      },

      'stop': function STOP() {
        runtime_error(ERRORS.INTERRUPT);
      },

      'end': function END() {
        throw new EndProgram();
      },


      //////////////////////////////////////////////////////////////////////
      //
      // Error Handling Statements
      //
      //////////////////////////////////////////////////////////////////////

      'onerr_goto': function ONERR_GOTO(line) {
        state.onerr_handler = line;
      },

      'resume': function RESUME() {
        state.stmt_index = state.resume_stmt_index;
        state.line_number = state.resume_line_number;
      },

      //////////////////////////////////////////////////////////////////////
      //
      // Inline Data Statements
      //
      //////////////////////////////////////////////////////////////////////

      'restore': function RESTORE() {
        state.data_index = 0;
      },

      // PERF: optimize by turning into a function, e.g. "state.parsevar(name, lib.read())"
      'read': function READ(lvalue1, lvalue2 /* ... */) {
        unused(lvalue1, lvalue2);

        var lvalues = Array.prototype.slice.call(arguments);
        while (lvalues.length) {
          if (state.data_index >= state.data.length) {
            runtime_error(ERRORS.OUT_OF_DATA);
          }
          (lvalues.shift())(state.data[state.data_index]);
          state.data_index += 1;
        }
      },

      //////////////////////////////////////////////////////////////////////
      //
      // I/O Statements
      //
      //////////////////////////////////////////////////////////////////////

      'print': function PRINT(string1, string2 /* ... */) {
        unused(string1, string2);

        var args = Array.prototype.slice.call(arguments), arg;
        while (args.length) {
          arg = args.shift();
          if (typeof arg === 'function') {
            arg = arg();
          }
          env.tty.writeString(String(arg));
        }
      },

      'comma': function COMMA() {
        return function() {
          var cur = env.tty.getCursorPosition().x,
                        pos = (cur + 16) - (cur % 16);
          if (pos >= env.tty.getScreenSize().width) {
            return '\r';
          } else {
            return ' '.repeat(pos - cur);
          }
        };

      },

      'spc': function SPC(n) {
        n = n >> 0;
        if (n < 0 || n > 255) {
          runtime_error(ERRORS.ILLEGAL_QUANTITY);
        }
        return function() {
          return ' '.repeat(n);
        };
      },

      'tab': function TAB(n) {
        n = n >> 0;
        if (n < 0 || n > 255) {
          runtime_error(ERRORS.ILLEGAL_QUANTITY);
        }
        if (n === 0) { n = 256; }

        return function() {
          var pos = env.tty.getCursorPosition().x + 1;
          return ' '.repeat(pos >= n ? 0 : n - pos);
        };
      },

      'get': function GET(lvalue) {
        var im = env.tty.readChar,
                    ih = function(entry) {
                      lvalue(entry);
                    };
        throw new BlockingInput(im, ih);
      },

      'input': function INPUT(prompt, var1, var2 /* ... */) {
        unused(var1, var2);
        var varlist = Array.prototype.slice.call(arguments, 1); // copy for closure
        var im, ih;
        im = function(cb) { return env.tty.readLine(cb, prompt); };
        ih = function(entry) {
          var parts = [],
                        stream = new Stream(entry);

          parseDataInput(stream, parts);

          while (varlist.length && parts.length) {
            try {
              varlist.shift()(parts.shift());
            } catch (e) {
              if (e instanceof basic.RuntimeError &&
                                e.code === ERRORS.TYPE_MISMATCH[0]) {
                e.code = ERRORS.REENTER[0];
                e.message = ERRORS.REENTER[1];
              }
              throw e;
            }
          }

          if (varlist.length) {
            prompt = '??';
            throw new BlockingInput(im, ih);
          }

          if (parts.length) {
            env.tty.writeString('?EXTRA IGNORED\r');
          }
        };
        throw new BlockingInput(im, ih);
      },

      'home': function HOME() {
        if (env.tty.clearScreen) { env.tty.clearScreen(); }
      },

      'htab': function HTAB(pos) {
        if (pos < 1 || pos >= env.tty.getScreenSize().width + 1) {
          runtime_error(ERRORS.ILLEGAL_QUANTITY);
        }

        if (env.tty.textWindow) {
          pos += env.tty.textWindow.left;
        }

        env.tty.setCursorPosition(pos - 1, void 0);
      },

      'vtab': function VTAB(pos) {
        if (pos < 1 || pos >= env.tty.getScreenSize().height + 1) {
          runtime_error(ERRORS.ILLEGAL_QUANTITY);
        }
        env.tty.setCursorPosition(void 0, pos - 1);
      },

      'inverse': function INVERSE() {
        if (env.tty.setTextStyle) { env.tty.setTextStyle(env.tty.TEXT_STYLE_INVERSE); }
      },
      'flash': function FLASH() {
        if (env.tty.setTextStyle) { env.tty.setTextStyle(env.tty.TEXT_STYLE_FLASH); }
      },
      'normal': function NORMAL() {
        if (env.tty.setTextStyle) { env.tty.setTextStyle(env.tty.TEXT_STYLE_NORMAL); }
      },
      'text': function TEXT() {
        if (env.display) {
          env.display.setState("graphics", false);
        }

        if (env.tty.textWindow) {
          // Reset text window
          env.tty.textWindow = {
            left: 0,
            top: 0,
            width: env.tty.getScreenSize().width,
            height: env.tty.getScreenSize().height
          };
        }
      },

      //////////////////////////////////////////////////////////////////////
      //
      // Miscellaneous Statements
      //
      //////////////////////////////////////////////////////////////////////

      'notrace': function NOTRACE() {
        state.trace_mode = false;
      },
      'trace': function TRACE() {
        state.trace_mode = true;
      },

      //////////////////////////////////////////////////////////////////////
      //
      // Lores Graphics
      //
      //////////////////////////////////////////////////////////////////////

      'gr': function GR() {
        if (!env.lores) { runtime_error('Lores graphics not supported'); }
        env.display.setState("lores", true, "full", false, "graphics", true);
        env.lores.clear();

        env.tty.setCursorPosition(0, env.tty.getScreenSize().height);
      },

      'color': function COLOR(n) {
        if (!env.lores) { runtime_error('Lores graphics not supported'); }

        n = n >> 0;
        if (n < 0) { runtime_error(ERRORS.ILLEGAL_QUANTITY); }

        env.lores.setColor(n);
      },

      'plot': function PLOT(x, y) {
        if (!env.lores) { runtime_error('Lores graphics not supported'); }

        x = x >> 0;
        y = y >> 0;

        var size = env.lores.getScreenSize();
        if (x < 0 || y < 0 || x >= size.width || y >= size.height) {
          runtime_error(ERRORS.ILLEGAL_QUANTITY);
        }

        env.lores.plot(x, y);
      },

      'hlin': function HLIN(x1, x2, y) {
        if (!env.lores) { runtime_error('Lores graphics not supported'); }

        x1 = x1 >> 0;
        x2 = x2 >> 0;
        y = y >> 0;

        var size = env.lores.getScreenSize();
        if (x1 < 0 || x2 < 0 || y < 0 ||
                    x1 >= size.width || x2 >= size.width || y >= size.height) {
          runtime_error(ERRORS.ILLEGAL_QUANTITY);
        }

        env.lores.hlin(x1, x2, y);
      },

      'vlin': function VLIN(y1, y2, x) {
        if (!env.lores) { runtime_error('Lores graphics not supported'); }

        y1 = y1 >> 0;
        y2 = y2 >> 0;
        x = x >> 0;

        var size = env.lores.getScreenSize();
        if (x < 0 || y1 < 0 || y2 < 0 ||
                    x >= size.width || y1 >= size.height || y2 >= size.height) {
          runtime_error(ERRORS.ILLEGAL_QUANTITY);
        }

        env.lores.vlin(y1, y2, x);
      },


      //////////////////////////////////////////////////////////////////////
      //
      // Hires Graphics
      //
      //////////////////////////////////////////////////////////////////////


      'hgr': function HGR() {
        if (!env.hires) { runtime_error('Hires graphics not supported'); }
        env.display.setState("lores", false, "full", false, "page1", true, "graphics", true);
        env.display.hires_plotting_page = 1;
        env.hires.clear();
      },

      'hgr2': function HGR2() {
        if (!env.hires) { runtime_error('Hires graphics not supported'); }
        env.display.setState("lores", false, "full", true, "page1", false, "graphics", true);
        env.display.hires_plotting_page = 2;
        env.hires2.clear();
      },

      'hcolor': function HCOLOR(n) {
        if (!env.hires) { runtime_error('Hires graphics not supported'); }
        n = n >> 0;
        if (n < 0 || n > 7) { runtime_error(ERRORS.ILLEGAL_QUANTITY); }
        env.hires.setColor(n);
        if (env.hires2) { env.hires2.setColor(n); }
      },

      'hplot': function HPLOT(x1, y1, x2, y2 /* ...  */) {
        unused(x1, y1, x2, y2);

        var hires = env.display.hires_plotting_page === 2 ? env.hires2 : env.hires;
        if (!hires) { runtime_error('Hires graphics not supported'); }

        var coords = Array.prototype.slice.call(arguments),
                    size = hires.getScreenSize(),
                    x, y;

        x = coords.shift() >> 0;
        y = coords.shift() >> 0;

        if (x < 0 || y < 0 || x >= size.width || y >= size.height) {
          runtime_error(ERRORS.ILLEGAL_QUANTITY);
        }

        hires.plot(x, y);
        while (coords.length) {
          x = coords.shift() >> 0;
          y = coords.shift() >> 0;
          if (x < 0 || y < 0 || x >= size.width || y >= size.height) {
            runtime_error(ERRORS.ILLEGAL_QUANTITY);
          }
          hires.plot_to(x, y);
        }
      },

      'hplot_to': function HPLOT_TO(x1, y1, x2, y2 /* ...  */) {
        unused(x1, y1, x2, y2);

        var hires = env.display.hires_plotting_page === 2 ? env.hires2 : env.hires;
        if (!hires) { runtime_error('Hires graphics not supported'); }

        var coords = Array.prototype.slice.call(arguments),
                    size = hires.getScreenSize(), x, y;

        while (coords.length) {
          x = coords.shift() >> 0;
          y = coords.shift() >> 0;

          if (x < 0 || y < 0 || x >= size.width || y >= size.height) {
            runtime_error(ERRORS.ILLEGAL_QUANTITY);
          }

          hires.plot_to(x, y);
        }
      },


      //////////////////////////////////////////////////////////////////////
      //
      // Compatibility shims
      //
      //////////////////////////////////////////////////////////////////////

      'pr#': function PR(slot) {
        if (slot === 0) {
          if (env.tty.setFirmwareActive) { env.tty.setFirmwareActive(false); }
        } else if (slot === 3) {
          if (env.tty.setFirmwareActive) { env.tty.setFirmwareActive(true); }
        }
      },

      'poke': function POKE(address, value) {
        address = address & 0xffff;

        value = value >> 0;
        if (value < 0 || value > 255) {
          runtime_error(ERRORS.ILLEGAL_QUANTITY);
        }

        if (!({}.hasOwnProperty.call(poke_table, address))) {
          runtime_error("Unsupported POKE location: " + address);
        }

        poke_table[address](value);
      },

      'call': function CALL(address) {
        address = address & 0xffff;

        if (!({}.hasOwnProperty.call(call_table, address))) {
          runtime_error("Unsupported POKE location: " + address);
        }

        call_table[address]();
      },

      'speed': function SPEED(n) {
        n = n >> 0;
        if (n < 0 || n > 255) {
          runtime_error(ERRORS.ILLEGAL_QUANTITY);
        }

        env.tty.speed = n;
      },

      //////////////////////////////////////////////////////////////////////
      //
      // Referenced by compiled functions
      //
      //////////////////////////////////////////////////////////////////////

      'div': function _div(n, d) {
        var r = n / d;
        if (!isFinite(r)) { runtime_error(ERRORS.DIVISION_BY_ZERO); }
        return r;
      },

      'fn': function _fn(name, arg) {
        if (!{}.hasOwnProperty.call(state.functions, name)) {
          runtime_error(ERRORS.UNDEFINED_FUNCTION);
        }
        return state.functions[name](arg);
      },

      'checkFinite': function _checkFinite(n) {
        if (!isFinite(n)) { runtime_error(ERRORS.OVERFLOW); }
        return n;
      },

      'toint': function _toint(n) {
        n = n >> 0;
        if (n > 0x7fff || n < -0x8000) { runtime_error(ERRORS.ILLEGAL_QUANTITY); }
        return n;
      }
    };

    // Apply a signature [return_type, arg0_type, arg1_type, ...] to a function
    function funcsign(func, return_type, arg0_type, arg1_type /* ... */) {
      unused(return_type, arg0_type, arg1_type);

      func.signature = Array.prototype.slice.call(arguments, 1);
      return func;
    }

    funlib = {

      //////////////////////////////////////////////////////////////////////
      //
      // Functions
      //
      // name: [ impl, returntype, [arg0type [, arg1type [, ... ] ]
      //
      //////////////////////////////////////////////////////////////////////


      "ABS": funcsign(Math.abs, 'number', 'number'),
      "ASC": funcsign(function(s) {
        if (s.length < 1) { runtime_error(ERRORS.ILLEGAL_QUANTITY); }
        return s.charCodeAt(0);
      }, 'number', 'string'),
      "ATN": funcsign(Math.atan, 'number', 'number'),
      "CHR$": funcsign(String.fromCharCode, 'string', 'number'),
      "COS": funcsign(Math.cos, 'number', 'number'),
      "EXP": funcsign(Math.exp, 'number', 'number'),
      "INT": funcsign(Math.floor, 'number', 'number'),
      "LEN": funcsign(function LEN(s) { return s.length; }, 'number', 'string'),
      "LOG": funcsign(Math.log, 'number', 'number'),
      "SGN": funcsign(function SGN(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }, 'number', 'number'),
      "SIN": funcsign(Math.sin, 'number', 'number'),
      "SQR": funcsign(Math.sqrt, 'number', 'number'),
      "STR$": funcsign(function STR$(n) { return n.toString(); }, 'string', 'number'),
      "TAN": funcsign(Math.tan, 'number', 'number'),
      "VAL": funcsign(function VAL(s) {
        var n = parseFloat(s);
        return isFinite(n) ? n : 0;
      }, 'number', 'string'),

      "RND": funcsign(function RND(n) {
        if (n > 0) {
          // Next in PRNG sequence
          return state.prng.next();
        } else if (n < 0) {
          // Re-seed. NOTE: Not predictable as in Applesoft
          state.prng.seed(n);
          return state.prng.next();
        }
        return state.prng.last;
      }, 'number', 'number'),

      "LEFT$": funcsign(function LEFT$(s, n) { return s.substring(0, n); }, 'string', 'string', 'number'),
      "MID$": funcsign(function MID$(s, n, n2) { return n2 === (void 0) ? s.substring(n - 1) : s.substring(n - 1, n + n2 - 1); }, 'string', 'string', 'number', 'number?'),
      "RIGHT$": funcsign(function RIGHT$(s, n) { return s.length < n ? s : s.substring(s.length - n); }, 'string', 'string', 'number'),

      "POS": funcsign(function POS(n) { unused(n); return env.tty.getCursorPosition().x; }, 'number', 'number'),
      "SCRN": funcsign(function SCRN(x, y) {
        if (!env.lores) { runtime_error("Graphics not supported"); }
        x = x >> 0;
        y = y >> 0;
        var size = env.lores.getScreenSize();
        if (x < 0 || y < 0 || x >= size.width || y >= size.height) {
          runtime_error(ERRORS.ILLEGAL_QUANTITY);
        }

        return env.lores.getPixel(x, y);
      }, 'number', 'number', 'number'),
      "HSCRN": funcsign(function HSCRN(x, y) {
        var hires = env.display.hires_plotting_page === 2 ? env.hires2 : env.hires;
        if (!hires) { runtime_error("Graphics not supported"); }

        x = x >> 0;
        y = y >> 0;
        var size = hires.getScreenSize();
        if (x < 0 || y < 0 || x >= size.width || y >= size.height) {
          runtime_error(ERRORS.ILLEGAL_QUANTITY);
        }

        return hires.getPixel(x, y);
      }, 'number', 'number', 'number'),

      "PDL": funcsign(function PDL(n) {
        if (env.paddle) {
          return (env.paddle(n) * 255) & 0xff;
        } else {
          runtime_error('Paddles not attached');
        }
      }, 'number', 'number'),
      "FRE": funcsign(function FRE(n) {
        unused(n);
        return JSON ? JSON.stringify([state.variables, state.arrays, state.functions]).length : 0;
      }, 'number', 'number'),
      "PEEK": funcsign(function PEEK(address) {
        address = address & 0xffff;
        if (!{}.hasOwnProperty.call(peek_table, address)) {
          runtime_error("Unsupported PEEK location: " + address);
        }
        return peek_table[address]();
      }, 'number', 'number'),

      // Not supported
      "USR": funcsign(function USR(n) { unused(n); runtime_error("USR Function not supported"); }, 'number', 'number')
    };


    //----------------------------------------------------------------------
    //
    // Parser / Compiler
    //
    //----------------------------------------------------------------------

    var program = (function() {

      var identifiers = {
        variables: {},
        arrays: {}
      };

      //////////////////////////////////////////////////////////////////////
      //
      // Lexical Analysis
      //
      //////////////////////////////////////////////////////////////////////

      var match, test, endOfStatement, endOfProgram,
                currLine = 0, currColumn = 0,
                currLineNumber = 0;

      function parse_error(msg) {
        var e = new basic.ParseError(msg + " in line " + currLineNumber,
                    currLine, currColumn);

        throw e;
      }


      (function(source) {
        function munge(kw) {
          // Escape special characters
          function escape(c) { return /[\[\]\\\^\$\.\|\?\*\+\(\)]/.test(c) ? '\\' + c : c; }
          // Allow linear whitespace between characters
          //return kw.split('').map(escape).join('[ \\t]*');

          // Allow linear whitespace in HCOLOR=, HIMEM:, CHR$, etc
          return kw.split(/(?=\W)/).map(escape).join('[ \\t]*');
        }

        var RESERVED_WORDS = [
        // NOTE: keywords that are stems of other words need to go after (e.g. "NOTRACE", "NOT)
                    "ABS", "AND", "ASC", "ATN", "AT", "CALL", "CHR$", "CLEAR", "COLOR=", "CONT", "COS",
        /*"DATA",*/"DEF", "DEL", "DIM", "DRAW", "END", "EXP", "FLASH", "FN", "FOR", "FRE", "GET",
                    "GOSUB", "GOTO", "GR", "HCOLOR=", "HGR2", "HGR", "HIMEM:", "HLIN", "HOME", "HPLOT",
                    "HTAB", "IF", "IN#", "INPUT", "INT", "INVERSE", "LEFT$", "LEN", "LET", "LIST",
                    "LOAD", "LOG", "LOMEM:", "MID$", "NEW", "NEXT", "NORMAL", "NOTRACE", "NOT", "ONERR",
                    "ON", "OR", "PDL", "PEEK", "PLOT", "POKE", "POP", "POS", "PRINT", "PR#", "READ",
                    "RECALL", /*"REM",*/"RESTORE", "RESUME", "RETURN", "RIGHT$", "RND", "ROT=", "RUN",
                    "SAVE", "SCALE=", "SCRN", "SGN", "SHLOAD", "SIN", "SPC", "SPEED=", "SQR", "STEP",
                    "STOP", "STORE", "STR$", "TAB", "TAN", "TEXT", "THEN", "TO", "TRACE", "USR", "VAL",
                    "VLIN", "VTAB", "WAIT", "XDRAW", "&", "?",
                    "HSCRN"
                ],
                    regexReservedWords = new RegExp("^(" + RESERVED_WORDS.map(munge).join("|") + ")", "i"),
                    regexIdentifier = new RegExp('^([A-Za-z][A-Za-z0-9]?)[A-Za-z0-9]*(\\$|%)?'),
                    regexStringLiteral = new RegExp('^"([^"]*?)(?:"|(?=\\n|\\r|$))'),
                    regexNumberLiteral = new RegExp('^([0-9]*\\.?[0-9]+(?:[eE]\\s*[\\-+]?\\s*[0-9]+)?)'),
                    regexOperator = new RegExp('^(;|<[ \t]*=|=[ \t]*<|>[ \t]*=|=[ \t]*>|=[ \t]*=|<[ \t]*>|>[ \t]*<|=|<|>|\\+|-|\\*|/|\\^|\\(|\\)|,)'),

                    regexLineNumber = new RegExp('^([0-9]+)'),
                    regexSeparator = new RegExp('^(:)'),

                    regexRemark = new RegExp('^(' + munge('REM') + '([^\r\n]*))', 'i'),
                    regexData = new RegExp('^(' + munge('DATA') + ')', 'i'),

                    regexLinearWhitespace = new RegExp('^[ \t]+'),
                    regexNewline = new RegExp('^\r?\n');

        // Token types:
        //    lineNumber    - start of a new line
        //    separator     - separates statements on same line
        //    reserved      - reserved keyword (command, function, etc)
        //    identifier    - variable name
        //    string        - string literal
        //    number        - number literal
        //    operator      - operator
        //    remark        - REM blah
        //    data          - DATA blah,"blah",blah

        var start = true,
                    stream = new Stream(source);

        function nextToken() {
          var token = {}, newline = start, ws;
          start = false;

          currLine = stream.line + 1;
          currColumn = stream.column + 1;

          // Consume whitespace
          do {
            ws = false;
            if (stream.match(regexLinearWhitespace)) {
              ws = true;
            } else if (stream.match(regexNewline)) {
              ws = true;
              newline = true;
            }
          } while (ws);

          if (stream.eof()) {
            return (void 0);
          }

          if (newline) {
            if (stream.match(regexLineNumber)) {
              token.lineNumber = Number(stream.lastMatch[1]);
            } else if (stream.match(regexSeparator)) {
              // Extension - allow leading : to continue previous line
              token.separator = stream.lastMatch[1];
            } else {
              parse_error("Syntax error: Expected line number or separator");
            }
          } else if (stream.match(regexRemark)) {
            token.remark = stream.lastMatch[2];
          } else if (stream.match(regexData)) {
            token.data = [];
            parseDataInput(stream, token.data);
          } else if (stream.match(regexReservedWords)) {
            token.reserved = stream.lastMatch[1].toUpperCase().replace(/\s+/g, '');
            if (token.reserved === "?") { token.reserved = "PRINT"; } // HACK
          } else if (stream.match(regexIdentifier)) {
            token.identifier = stream.lastMatch[1].toUpperCase() + (stream.lastMatch[2] || ''); // Canonicalize identifier name
          } else if (stream.match(regexStringLiteral)) {
            token.string = stream.lastMatch[1];
          } else if (stream.match(regexNumberLiteral)) {
            token.number = parseFloat(stream.lastMatch[1].replace(/\s+/g, ''));
          } else if (stream.match(regexOperator)) {
            token.operator = stream.lastMatch[1].replace(/\s+/g, '');
          } else if (stream.match(regexSeparator)) {
            token.separator = stream.lastMatch[1];
          } else {
            parse_error("Syntax error: Unexpected '" + source.substr(0, 40) + "'");
          }
          return token;
        }

        var lookahead = nextToken();

        match = function _match(type, value) {

          if (!lookahead) {
            parse_error("Syntax error: Expected " + type + ", saw end of file");
          }

          var token = lookahead;
          if ('lineNumber' in token) {
            currLineNumber = token.lineNumber;
          }
          lookahead = nextToken();

          if (!{}.hasOwnProperty.call(token, type)) {
            parse_error("Syntax error: Expected " + type + ", saw " + JSON.stringify(token));
          }

          if (value !== (void 0) && token[type] !== value) {
            parse_error("Syntax error: Expected '" + value + "', saw " + JSON.stringify(token));
          }

          return token[type];
        };

        test = function _test(type, value, consume) {
          if (lookahead && {}.hasOwnProperty.call(lookahead, type) &&
                        (value === (void 0) || lookahead[type] === value)) {

            if (consume) {
              var token = lookahead;
              if ('lineNumber' in token) {
                currLineNumber = token.lineNumber;
              }
              lookahead = nextToken();
            }

            return true;
          }

          return false;
        };

        endOfStatement = function _endOfStatement() {
          return !lookahead ||
                        {}.hasOwnProperty.call(lookahead, 'separator') ||
                        {}.hasOwnProperty.call(lookahead, 'lineNumber');
        };

        endOfProgram = function _endOfProgram() {
          return !lookahead;
        };

      } (source));


      //////////////////////////////////////////////////////////////////////
      //
      // Compiler utility functions
      //
      //////////////////////////////////////////////////////////////////////

      function quote(string) {
        // From json2.js (http://www.json.org/js.html)
        var escapable = new RegExp('[\\\\"\\x00-\\x1f\\x7f-\\x9f\\u00ad\\u0600-\\u0604\\u070f\\u17b4\\u17b5\\u200c-\\u200f\\u2028-\\u202f\\u2060-\\u206f\\ufeff\\ufff0-\\uffff]', 'g'),
                    meta = {    // table of character substitutions
                      '\b': '\\b',
                      '\t': '\\t',
                      '\n': '\\n',
                      '\f': '\\f',
                      '\r': '\\r',
                      '"': '\\"',
                      '\\': '\\\\'
                    };

        return '"' + string.replace(escapable, function(a) {
          var c = meta[a];
          return c ? c : '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
        }) + '"';
      }


      //////////////////////////////////////////////////////////////////////
      //
      // Recursive Descent Parser
      //
      //////////////////////////////////////////////////////////////////////

      var parseExpression, parseSubscripts;

      //
      // Type Checking
      //

      function parseAnyExpression() {
        var expr = parseExpression();
        return expr.source;
      }

      function enforce_type(actual, expected) {
        if (actual !== expected) {
          parse_error('Type mismatch error: Expected ' + expected);
        }
      }

      function parseStringExpression() {
        var expr = parseExpression();
        enforce_type(expr.type, 'string');
        return expr.source;
      }

      function parseNumericExpression() {
        var expr = parseExpression();
        enforce_type(expr.type, 'number');
        return expr.source;
      }

      //
      // Variables
      //

      parseSubscripts = function() {
        var subscripts; // undefined = no subscripts

        if (test('operator', '(', true)) {

          subscripts = [];

          do {
            subscripts.push(parseNumericExpression());
          } while (test('operator', ',', true));

          match("operator", ")");

          return subscripts.join(',');
        }
        return (void 0);
      };

      function parsePValue() {
        var name = match('identifier'),
                    subscripts = parseSubscripts();

        if (subscripts) {
          identifiers.arrays[name] = true;
          return '(function (value){state.parsevar(' +
                        quote(name) + ',[' + subscripts + '],value);})';
        } else {
          identifiers.variables[name] = true;
          return '(function (value){state.parsevar(' +
                        quote(name) + ',value);})';
        }
      }


      //
      // Expressions
      //

      parseExpression = (function() {
        // closure to keep things tidy

        function parseUserfunction() {
          var name = match('identifier'),
                        type = vartype(name) === 'string' ? 'string' : 'number',
                        expr;

          // FUTURE: Allow differing argument type and return type
          // (may require runtime type checks)

          // Determine the function argument
          match("operator", "(");
          expr = type === 'string' ? parseStringExpression() : parseNumericExpression();
          match("operator", ")");

          return { source: 'lib.fn(' + quote(name) + ',' + expr + ')', type: type };
        }


        function parsefunction(name) {
          if (!{}.hasOwnProperty.call(funlib, name)) {
            parse_error("Undefined function: " + name);
          }

          match("operator", "(");

          var func = funlib[name],
                        funcdesc = func.signature.slice(),
                        rtype = funcdesc.shift(),
                        args = [],
                        atype;

          while (funcdesc.length) {
            atype = funcdesc.shift();

            if (/\?$/.test(atype)) {
              if (test('operator', ')')) {
                break;
              } else {
                atype = atype.substring(0, atype.length - 1);
              }
            }
            if (args.length) {
              match("operator", ",");
            }

            if (atype === 'string') {
              args.push(parseStringExpression());
            } else if (atype === 'number') {
              args.push(parseNumericExpression());
            } else {
              throw new Error("Invalid function definition");
            }
          }

          match("operator", ")");

          return { source: 'funlib.' + name + '(' + args.join(',') + ')', type: rtype };
        }

        function parseFinalExpression() {
          if (test('number')) {
            return { source: String(match('number')), type: 'number' };
          } else if (test('string')) {
            return { source: quote(match('string')), type: 'string' };
          } else if (test('reserved', 'FN', true)) {
            return parseUserfunction();
          } else if (test('reserved')) {
            return parsefunction(match('reserved'));
          } else if (test('identifier')) {
            var name = match('identifier'),
                            type = vartype(name) === 'string' ? 'string' : 'number',
                            subscripts = parseSubscripts();
            if (subscripts) {
              identifiers.arrays[name] = true;
              return { source: 'state.arrays[' + quote(name) + '].get([' + subscripts + '])', type: type };
            } else {
              identifiers.variables[name] = true;
              return { source: 'state.variables[' + quote(name) + ']', type: type };
            }
          } else {
            match("operator", "(");
            var expr = parseExpression();
            match("operator", ")");
            return expr;
          }
        }

        function parseUnaryExpression() {
          var rhs, op;

          if (test('operator', '+') || test('operator', '-')) {
            op = match('operator');
          } else if (test('reserved', 'NOT')) {
            op = match('reserved');
          }

          if (op) {
            rhs = parseUnaryExpression();

            enforce_type(rhs.type, 'number');

            switch (op) {
              case "+": return rhs;
              case "-": return { source: '(-' + rhs.source + ')', type: 'number' };
              case "NOT": return { source: '((!' + rhs.source + ')?1:0)', type: 'number' };
            }
          }
          return parseFinalExpression();
        }

        function parsePowerExpression() {
          var lhs = parseUnaryExpression(), rhs;
          while (test('operator', '^', true)) {
            rhs = parseUnaryExpression();

            enforce_type(lhs.type, 'number');
            enforce_type(rhs.type, 'number');

            lhs = { source: 'Math.pow(' + lhs.source + ',' + rhs.source + ')', type: 'number' };
          }
          return lhs;
        }

        function parseMultiplicativeExpression() {
          var lhs = parsePowerExpression(), rhs, op;
          while (test('operator', '*') || test('operator', '/')) {
            op = match('operator');
            rhs = parsePowerExpression();

            enforce_type(lhs.type, 'number');
            enforce_type(rhs.type, 'number');

            switch (op) {
              case "*": lhs = { source: '(' + lhs.source + '*' + rhs.source + ')', type: 'number' }; break;
              case "/": lhs = { source: 'lib.div(' + lhs.source + ',' + rhs.source + ')', type: 'number' }; break;
            }
          }
          return lhs;
        }

        function parseAdditiveExpression() {
          var lhs = parseMultiplicativeExpression(), rhs, op;
          while (test('operator', '+') || test('operator', '-')) {
            op = match('operator');
            rhs = parseMultiplicativeExpression();

            switch (op) {
              case "+":
                enforce_type(rhs.type, lhs.type);
                lhs = { source: '(' + lhs.source + '+' + rhs.source + ')', type: lhs.type }; break;
              case "-":
                enforce_type(lhs.type, 'number');
                enforce_type(rhs.type, 'number');
                lhs = { source: '(' + lhs.source + '-' + rhs.source + ')', type: lhs.type }; break;
            }
          }
          return lhs;
        }

        function parseRelationalExpression() {
          var lhs = parseAdditiveExpression(), rhs, op;
          while (
                        test('operator', '<') || test('operator', '>') ||
                        test('operator', '=') || test('operator', '==') ||
                        test('operator', '<=') || test('operator', '=<') ||
                        test('operator', '>=') || test('operator', '=>') ||
                        test('operator', '<>') || test('operator', '><')) {

            op = match('operator');

            rhs = parseAdditiveExpression();

            enforce_type(rhs.type, lhs.type);

            switch (op) {
              case "<": lhs = { source: '((' + lhs.source + '<' + rhs.source + ')?1:0)', type: 'number' }; break;
              case ">": lhs = { source: '((' + lhs.source + '>' + rhs.source + ')?1:0)', type: 'number' }; break;
              case "<=":
              case "=<": lhs = { source: '((' + lhs.source + '<=' + rhs.source + ')?1:0)', type: 'number' }; break;
              case ">=":
              case "=>": lhs = { source: '((' + lhs.source + '>=' + rhs.source + ')?1:0)', type: 'number' }; break;
              case "=":
              case "==": lhs = { source: '((' + lhs.source + '===' + rhs.source + ')?1:0)', type: 'number' }; break;
              case "<>":
              case "><": lhs = { source: '((' + lhs.source + '!==' + rhs.source + ')?1:0)', type: 'number' }; break;
            }
          }
          return lhs;
        }

        function parseAndExpression() {
          var lhs = parseRelationalExpression(), rhs;
          while (test('reserved', 'AND', true)) {
            rhs = parseRelationalExpression();

            enforce_type(lhs.type, 'number');
            enforce_type(rhs.type, 'number');

            lhs = {
              source: '((' + lhs.source + '&&' + rhs.source + ')?1:0)',
              type: 'number'
            };
          }
          return lhs;
        }

        function parseOrExpression() {
          var lhs = parseAndExpression(), rhs;
          while (test('reserved', 'OR', true)) {
            rhs = parseAndExpression();

            enforce_type(lhs.type, 'number');
            enforce_type(rhs.type, 'number');

            lhs = {
              source: '((' + lhs.source + '||' + rhs.source + ')?1:0)',
              type: 'number'
            };
          }
          return lhs;
        }

        return parseOrExpression;
      } ());


      //
      // Statements
      //

      function parseCommand() {

        function slib(name, arg0, arg1 /* ... */) {
          unused(arg0, arg1);
          var args = Array.prototype.slice.call(arguments, 1);
          return 'lib[' + quote(name) + '](' + args.join(',') + ');';
        }

        var keyword = test('identifier') ? 'LET' : match('reserved'),
                    name, type, subscripts, is_to, expr, param, args, prompt, trailing, js;

        switch (keyword) {
          //////////////////////////////////////////////////////////////////////
          //
          // Variable Statements
          //
          //////////////////////////////////////////////////////////////////////

          case "CLEAR": // Clear all variables
            return slib('clear');

          case "LET":  // Assign a variable, LET x = expr
            name = match('identifier');
            subscripts = parseSubscripts();
            match('operator', '=');

            type = vartype(name);
            if (type === 'int') {
              expr = 'lib.toint(lib.checkFinite(' + parseNumericExpression() + '))';
            } else if (type === 'float') {
              expr = 'lib.checkFinite(' + parseNumericExpression() + ')';
            } else { // type === 'string')
              expr = parseStringExpression();
            }

            if (!subscripts) {
              identifiers.variables[name] = true;
              return 'state.variables[' + quote(name) + '] = ' + expr;
            } else {
              identifiers.arrays[name] = true;
              return 'state.arrays[' + quote(name) + '].set([' + subscripts + '], ' + expr + ')';
            }

          case "DIM":
            js = '';
            do {
              name = match('identifier');
              subscripts = parseSubscripts();
              identifiers.arrays[name] = true;
              js += slib('dim', quote(name), '[' + subscripts + ']');
            } while (test('operator', ',', true));
            return js;

          case "DEF":     // DEF FN A(X) = expr
            match("reserved", "FN");
            name = match('identifier');
            match("operator", "(");
            param = match('identifier');
            match("operator", ")");
            match("operator", "=");

            if (vartype(name) !== vartype(param)) {
              parse_error("DEF FN function type and argument type must match");
            }

            expr = vartype(name) === 'string'
                            ? parseStringExpression()
                            : parseNumericExpression();

            return slib('def', quote(name),
                            'function (arg){' +
            // Save the current context/variable so we can evaluate
                            'var rv,ov=state.variables[' + quote(param) + '];' +
            // Swap in the argument
                            'state.variables[' + quote(param) + ']=arg;' +
            // Evaluate the user-function expression
                            'rv=' + expr + ';' +
            // Restore
                            'state.variables[' + quote(param) + ']=ov;' +
                            'return rv;' +
                            '}');

            //////////////////////////////////////////////////////////////////////
            //
            // Flow Control Statements
            //
            //////////////////////////////////////////////////////////////////////

          case "GOTO": // GOTO linenum
            return slib('goto', match("number"));

          case "ON":  // ON expr (GOTO|GOSUB) linenum[,linenum ... ]
            expr = parseNumericExpression();

            keyword = match('reserved');
            if (keyword !== "GOTO" && keyword !== "GOSUB") {
              parse_error("Syntax error: Expected GOTO or GOSUB");
            }

            args = [];
            do {
              args.push(match("number"));
            } while (test("operator", ",", true));

            return slib(keyword === 'GOSUB' ? 'on_gosub' : 'on_goto', expr, args.join(','));

          case "GOSUB": // GOSUB linenum
            return slib('gosub', match("number"));

          case "RETURN": // Return from the last GOSUB
            return slib('return');

          case "POP": // Turn last GOSUB into a GOTO
            return slib('pop');

          case "FOR": // FOR i = m TO n STEP s
            name = match('identifier');
            if (vartype(name) !== 'float') {
              parse_error("Syntax error: Expected floating point variable");
            }
            identifiers.variables[name] = true;

            return slib('for',
                            quote(name),
                            match("operator", "=") && parseNumericExpression(),
                            match("reserved", "TO") && parseNumericExpression(),
                            test('reserved', 'STEP', true) ? parseNumericExpression() : '1');

          case "NEXT": // NEXT [i [,j ... ] ]
            args = [];
            if (test('identifier')) {
              args.push(quote(match('identifier')));
              while (test("operator", ",", true)) {
                args.push(quote(match('identifier')));
              }
            }

            return slib('next', args.join(','));

          case "IF":  // IF expr (GOTO linenum|THEN linenum|THEN statement [:statement ... ]
            expr = parseAnyExpression();

            js = slib('if', expr);

            if (test('reserved', 'GOTO', true)) {
              // IF expr GOTO linenum
              return js + slib('goto', match('number'));
            }

            match('reserved', 'THEN');
            if (test('number')) {
              // IF expr THEN linenum
              return js + slib('goto', match('number'));
            } else {
              // IF expr THEN statement
              return js + parseCommand(); // recurse
            }

          case "END":  // End program
            return slib('end');

          case "STOP": // Break, like an error
            return slib('stop');

            //////////////////////////////////////////////////////////////////////
            //
            // Error Handling Statements
            //
            //////////////////////////////////////////////////////////////////////

          case "ONERR": // ONERR GOTO linenum
            return slib('onerr_goto',
                            match("reserved", "GOTO") && match("number"));

          case "RESUME":
            return slib('resume');

            //////////////////////////////////////////////////////////////////////
            //
            // Inline Data Statements
            //
            //////////////////////////////////////////////////////////////////////

          case "RESTORE":
            return slib('restore');

          case "READ":
            args = [];
            do {
              args.push(parsePValue());
            } while (test("operator", ",", true));

            return slib('read', args.join(','));

            //////////////////////////////////////////////////////////////////////
            //
            // I/O Statements
            //
            //////////////////////////////////////////////////////////////////////

          case "PRINT": // Output to the screen
            args = [];
            trailing = true;
            while (!endOfStatement()) {
              if (test('operator', ';', true)) {
                trailing = false;
              } else if (test('operator', ',', true)) {
                trailing = false;
                args.push('lib.comma()');
              } else if (test('reserved', 'SPC') || test('reserved', 'TAB')) {
                trailing = true;
                keyword = match('reserved');
                match("operator", "(");
                expr = parseNumericExpression();
                match("operator", ")");

                args.push('lib.' + (keyword === 'SPC' ? 'spc' : 'tab') + '(' + expr + ')');
              } else {
                trailing = true;
                args.push(parseAnyExpression());
              }
            }
            if (trailing) {
              args.push(quote('\r'));
            }

            return slib('print', args.join(','));

          case "INPUT": // Read input from keyboard
            prompt = '?';
            if (test('string')) {
              prompt = match('string');
              match("operator", ";");
            }

            args = [];

            do {
              args.push(parsePValue());
            } while (test("operator", ",", true));

            return slib('input', quote(prompt), args.join(','));

          case "GET": // Read character from keyboard
            return slib('get', parsePValue());

          case "HOME":  // Clear text screen
            return slib('home');

          case "HTAB":  // Set horizontal cursor position
            return slib('htab', parseNumericExpression());

          case "VTAB":  // Set vertical cursor position
            return slib('vtab', parseNumericExpression());

          case "INVERSE":  // Inverse text
            return slib('inverse');

          case "FLASH":  // Flashing text
            return slib('flash');

          case "NORMAL":  // Normal text
            return slib('normal');

          case "TEXT":  // Set display mode to text
            return slib('text');

            //////////////////////////////////////////////////////////////////////
            //
            // Miscellaneous Statements
            //
            //////////////////////////////////////////////////////////////////////

          case "NOTRACE":  // Turn off line tracing
            return slib('notrace');

          case "TRACE":  // Turn on line tracing
            return slib('trace');

            //////////////////////////////////////////////////////////////////////
            //
            // Lores Graphics
            //
            //////////////////////////////////////////////////////////////////////

          case "GR":   // Set display mode to lores graphics, clear screen
            return slib('gr');

          case "COLOR=":  // Set lores color
            return slib('color', parseNumericExpression());

          case "PLOT":  // Plot lores point
            return slib('plot',
                            parseNumericExpression(),
                            match("operator", ",") && parseNumericExpression());

          case "HLIN":  // Draw lores horizontal line
            return slib('hlin',
                            parseNumericExpression(),
                            match("operator", ",") && parseNumericExpression(),
                            match("reserved", "AT") && parseNumericExpression());

          case "VLIN":  // Draw lores vertical line
            return slib('vlin',
                            parseNumericExpression(),
                            match("operator", ",") && parseNumericExpression(),
                            match("reserved", "AT") && parseNumericExpression());

            //////////////////////////////////////////////////////////////////////
            //
            // Hires Graphics
            //
            //////////////////////////////////////////////////////////////////////

            // Hires Display Routines
          case "HGR":   // Set display mode to hires graphics, clear screen
            return slib('hgr');

          case "HGR2":  // Set display mode to hires graphics, page 2, clear screen
            return slib('hgr2');

          case "HCOLOR=":  // Set hires color
            return slib('hcolor', parseNumericExpression());

          case "HPLOT":  // Draw hires line
            is_to = test('reserved', 'TO', true);

            args = [];
            do {
              args.push(parseNumericExpression());
              match("operator", ",");
              args.push(parseNumericExpression());
            } while (test('reserved', 'TO', true));

            return slib(is_to ? 'hplot_to' : 'hplot', args.join(','));

            //////////////////////////////////////////////////////////////////////
            //
            // Compatibility shims
            //
            //////////////////////////////////////////////////////////////////////

          case "PR#":   // Direct output to slot
            return slib('pr#', parseNumericExpression());

          case "CALL":  // Call native routine
            return slib('call', parseNumericExpression());

          case "POKE":  // Set memory value
            return slib('poke',
                            parseNumericExpression(),
                            match("operator", ",") && parseNumericExpression());

          case "SPEED=":  // Output speed
            return slib('speed', parseNumericExpression());

            //////////////////////////////////////////////////////////////////////
            //
            // INTROSPECTION
            //
            //////////////////////////////////////////////////////////////////////

          case "LIST":  // List program statements
            parse_error("Introspection statement not supported: " + keyword);
            return;

            //////////////////////////////////////////////////////////////////////
            //
            // Statements that will never be implemented
            //
            //////////////////////////////////////////////////////////////////////

            // Shape tables
          case "ROT=":   // Set rotation angle for hires shape
          case "SCALE=": // Set rotation angle for hires shape
          case "DRAW":   // Draw hires shape
          case "XDRAW":  // XOR draw hires shape
            parse_error("Display statement not supported: " + keyword);
            return;

            // Interpreter Routines
          case "CONT":  // Continue stopped program (immediate mode)
          case "DEL":   // Deletes program statements
          case "NEW":   // Wipe program
          case "RUN":   // Execute program
            parse_error("Interpreter statement not supported: " + keyword);
            return;

            // Native Routines
          case "HIMEM:":  // Set upper bound of variable memory
          case "IN#":     // Direct input from slot
          case "LOMEM:":  // Set low bound of variable memory
          case "WAIT":    // Wait for memory value to match a condition
          case "&":       // Command hook
            parse_error("Native interop statement not supported: " + keyword);
            return;

            // Tape Routines
          case "LOAD":    // Load program from cassette port
          case "RECALL":  // Load array from cassette port
          case "SAVE":    // Save program to cassette port
          case "STORE":   // Store array to cassette port
          case "SHLOAD":  // Load shape table from cassette port
            parse_error("Tape statement not supported: " + keyword);
            return;

            //////////////////////////////////////////////////////////////////////
            //
            // NYI Statements
            //
            //////////////////////////////////////////////////////////////////////

            // Parts of other statements - AT, FN, STEP, TO, THEN, etc.
          default:
            parse_error("Syntax error: " + keyword);
            return;
        }
      }

      //
      // Top-level Program Structure
      //

      var parseProgram = function() {

        var program = {
          statements: [], // array of: [ line-number | statement-function ]
          data: [],       // array of [ string | number ]
          jump: []        // map of: { line-number: statement-index }
        };

        function mkfun(js) {
          /*jslint evil:true*/
          var fun; // NOTE: for IE; would prefer Function()
          eval('fun = (function (){' + js + '});');
          return fun;
        }

        function empty_statement() { }

        // Statement = data-declaration | remark | Command | EmptyStatement
        // Command   = identifier /*...*/ | reserved /*...*/
        function parseStatement() {
          if (test('data')) {
            program.data = program.data.concat(match('data'));
            return;
          } else if (test('remark', void 0, true)) {
            return;
          } else if (test('reserved') || test('identifier')) {
            program.statements.push(mkfun(parseCommand()));
          } else {
            // So TRACE output is correct
            program.statements.push(empty_statement);
          }
        }

        // Line = line-number Statement { separator Statement }
        function parseLine() {
          program.statements.push(match('lineNumber'));
          parseStatement();
          while (test('separator', ':', true)) {
            parseStatement();
          }
        }

        // Program = Line { Line }
        while (!endOfProgram()) {
          parseLine();
        }

        // Produce jump table
        program.statements.forEach(function(stmt, index) {
          if (typeof stmt === 'number') {
            program.jump[stmt] = index;
          }
        });

        program.variable_identifiers = Object.keys(identifiers.variables);
        program.array_identifiers = Object.keys(identifiers.arrays);

        return program;
      };

      return parseProgram();
    } ());

    program.init = function _init(environment) {

      // stuff these into runtime library closure/binding
      env = environment;
      state = {
        variables: {},
        arrays: {},
        functions: {},
        data: this.data,
        data_index: 0,
        stmt_index: 0,
        line_number: 0,
        stack: [],
        prng: new PRNG(),

        onerr_code: 255,
        onerr_handler: void 0,
        resume_stmt_index: 0,
        resume_line_number: 0,
        trace_mode: false,

        input_continuation: null,

        clear: function() {
          program.variable_identifiers.forEach(function(identifier) {
            state.variables[identifier] = vartype(identifier) === 'string' ? '' : 0;
          });

          program.array_identifiers.forEach(function(identifier) {
            state.arrays[identifier] = new BASICArray(vartype(identifier));
          });

          state.functions = {};
          state.data_index = 0;
        }
      };

      state.clear();

      state.parsevar = function _parsevar(name, subscripts, input) {

        if (arguments.length === 2) {
          input = arguments[1];
          subscripts = void 0;
        }
        var value;

        switch (vartype(name)) {
          case 'string':
            value = input;
            break;

          case 'int':
            value = Number(input);
            if (!isFinite(value)) { runtime_error(ERRORS.TYPE_MISMATCH); }
            value = lib.toint(value);
            break;

          case 'float':
            value = Number(input);
            if (!isFinite(value)) { runtime_error(ERRORS.TYPE_MISMATCH); }
            break;
        }

        if (subscripts) {
          state.arrays[name].set(subscripts, value);
        } else {
          state.variables[name] = value;
        }
      };
    };

    program.step = function _step(driver) {

      function gotoline(line) {
        if (!{}.hasOwnProperty.call(program.jump, line)) {
          runtime_error(ERRORS.UNDEFINED_STATEMENT);
        }
        state.stmt_index = program.jump[line];
      }

      var stmt;

      try {
        // for RuntimeError

        try {
          if (state.input_continuation) {
            var cont = state.input_continuation;
            state.input_continuation = null;
            cont(state.input_buffer);
          } else if (state.stmt_index >= program.statements.length) {
            return basic.STATE_STOPPED;
          } else {

            stmt = program.statements[state.stmt_index];

            if (typeof stmt === 'number') {
              state.line_number = stmt;
            } else if (typeof stmt === 'function') {
              if (state.trace_mode) {
                env.tty.writeString('#' + state.line_number + ' ');
              }
              stmt();
            } else {
              throw "WTF?";
            }
          }

          state.stmt_index += 1;
          return basic.STATE_RUNNING;

        } catch (e) {
          // These may throw RuntimeError
          if (e instanceof basic.RuntimeError) {
            throw e; // let outer catch block handle it
          } else if (e instanceof GoToLine) {
            gotoline(e.line);
            return basic.STATE_RUNNING;
          } else if (e instanceof NextLine) {
            while (state.stmt_index < program.statements.length &&
                            typeof program.statements[state.stmt_index] !== 'number') {
              state.stmt_index += 1;
            }
            return basic.STATE_RUNNING;
          } else if (e instanceof BlockingInput) {
            // what to call on next step() after input is handled
            state.input_continuation = e.callback;

            // call input method to prepare async input
            e.method(function(v) {
              state.input_buffer = v;
              if (driver) { driver(); }
            });

            return basic.STATE_BLOCKED;
          } else if (e instanceof EndProgram) {
            return basic.STATE_STOPPED;
          } else if (e instanceof Error && /stack|recursion/i.test(e.message)) {
            // IE: Error "Out of stack space"
            // Firefox: InternalError "too much recursion"
            // Safari: RangeError "Maximum call stack size exceeded"
            // Chrome: RangeError "Maximum call stack size exceeded"
            // Opera: Error "Maximum recursion depth exceeded"
            runtime_error(ERRORS.FORMULA_TOO_COMPLEX);
          } else if (e instanceof Error && /memory|overflow/i.test(e.message)) {
            // IE: Error "Out of memory"
            // Firefox: InternalError "allocation size overflow"
            // Safari: Error "Out of memory"
            // Chrome: (not catchable)
            // Opera: (not catchable)
            runtime_error(ERRORS.OUT_OF_MEMORY);
            // NOTE: not reliably generated; don't unit test
          } else {
            throw e;
          }
        }
      } catch (rte) {
        if (rte instanceof basic.RuntimeError) {
          state.onerr_code = rte.code || 0;
          if (state.onerr_handler !== void 0) {
            state.resume_stmt_index = state.stmt_index;
            state.resume_line_number = state.line_number;
            gotoline(state.onerr_handler);
            return basic.STATE_RUNNING;
          } else if (rte.code === ERRORS.REENTER[0]) {
            env.tty.writeString('?REENTER\r');
            return basic.STATE_RUNNING;
          } else {
            // annotate and report to the user
            rte.message += " in line " + state.line_number;
            throw rte;
          }
        } else {
          throw rte;
        }
      }
    };

    return program;
  };

  return basic;

} ());


// TODO: Unit tests for compile errors

// Console:
// For rhino: rhino basic.js your_basic_program.txt
// For CScript: CScript basic.js your_basic_program.txt

// TODO: DOS implementation

if (!window) {
  (function() {
    /*jslint windows: true, rhino: true */

    var console, program, state, filename, source;

    if (typeof WScript === 'object') {

      // Microsoft Windows Scripting engine

      if (WScript.Arguments.length !== 1) {
        WScript.StdOut.WriteLine("Usage: cscript basic.js program_name");
        WScript.Quit(-1);
      }
      filename = WScript.Arguments(0);

      source = (function() {
        var code = '',
                    fso = new ActiveXObject("Scripting.FileSystemObject"),
                    stream = fso.OpenTextFile(filename);
        while (!stream.AtEndOfStream) {
          code += stream.ReadLine() + '\n';
        }
        stream.Close();
        return code;
      } ());

      console = {
        gets: function() { return WScript.StdIn.ReadLine(); },
        getc: function() { return WScript.StdIn.ReadLine().substring(0, 1); },
        puts: function(s) { WScript.StdOut.Write(s); },
        putc: function(c) { WScript.StdOut.Write(c); },
        errs: function(s) { WScript.StdErr.Write(s); },
        quit: function(s) { WScript.Quit(s); }
      };
    } else if (typeof java === 'object') {

      // Mozilla Rhino

      if (arguments.length !== 1) {
        java.lang.System.err.println("Usage: rhino basic.js program_name");
        quit(1);
      }
      filename = arguments[0];

      source = (function() {
        var r = new java.io.BufferedReader(new java.io.FileReader(new java.io.File(filename))),
                    sb = new java.lang.StringBuilder(),
                    s;

        do {
          s = r.readLine();
          if (s !== null) {
            sb.append(s).append('\n');
          }
        } while (s !== null);
        return String(sb);
      } ());

      (function() {
        var stdin = new java.io.BufferedReader(new java.io.InputStreamReader(java.lang.System['in']));

        console = {
          gets: function() { return String(stdin.readLine()); },
          getc: function() { return String(stdin.readLine()).substring(0, 1); },
          puts: function(s) { java.lang.System.out.print(s); },
          putc: function(c) { java.lang.System.out.print(c); },
          errs: function(s) { java.lang.System.err.print(s); },
          quit: function(s) { quit(s); }
        };
      } ());
    } else {
      throw 'Unknown script host';
    }


    // Compile
    console.puts('Compiling...\n');
    try {
      program = basic.compile(source);
    } catch (pe) {
      if (pe instanceof basic.ParseError) {
        console.errs(pe.message + ' (source line: ' + pe.line + ', column: ' + pe.column + ')\n');
        console.quit(1);
      } else {
        throw pe;
      }
    }

    // Run
    console.puts('Running...\n');
    program.init({
      tty: {
        getCursorPosition: function() { return { x: 0, y: 0 }; },
        setCursorPosition: function() { },
        getScreenSize: function() { return { width: 80, height: 24 }; },
        writeChar: function(ch) { console.putc(ch.replace(/\r/g, '\n')); },
        writeString: function(string) { console.puts(string.replace(/\r/g, '\n')); },
        readChar: function(callback) {
          callback(console.getc());
        },
        readLine: function(callback, prompt) {
          console.puts(prompt);
          callback(console.gets().replace(/[\r\n]*/, ''));
        }
      }
    });

    try {
      do {
        state = program.step();
      } while (state !== basic.STATE_STOPPED);
    } catch (rte) {
      if (rte instanceof basic.RuntimeError) {
        console.errs(rte.message + '\n');
        console.quit(1);
      } else {
        throw rte;
      }
    }
  } ());
}

