#!/usr/bin/python3.12
"""Drive the built UI in a real WebKitGTK webview (the engine Tauri uses on Linux) and print frame statistics as JSON.

Run it under Xvfb (`run.mjs` does): xvfb-run -s "-screen 0 2880x1800x24" /usr/bin/python3.12 webkit-runner.py ...
It needs the system's PyGObject (`gi` with WebKit2 4.1), which is built for the distribution's Python, not for any
other Python on PATH (hence the explicit interpreter).

  --url URL            the page (the e2e build served over http)
  --scenarios a,b,c    scenario names from scenarios.js
  --css FILE / --js FILE   a variant: a stylesheet and/or a script applied after the app has booted
  --width/--height     the window in CSS pixels; GDK_SCALE=2 in the environment makes it a 2x display
  --out FILE           the JSON result
"""
import argparse, json, sys, time
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, GLib, WebKit2  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--url', required=True)
ap.add_argument('--scenarios', required=True)
ap.add_argument('--css')
ap.add_argument('--js')
ap.add_argument('--width', type=int, default=1440)
ap.add_argument('--height', type=int, default=900)
ap.add_argument('--out', required=True)
ap.add_argument('--scenarios-js', required=True)
ap.add_argument('--timeout', type=int, default=240)
ap.add_argument('--grab', help='record the screen region WxH+X+Y (device pixels) with ffmpeg x11grab to this .mkv while the scenarios run')
ap.add_argument('--grab-fps', type=int, default=30)
a = ap.parse_args()

scenarios_src = open(a.scenarios_js, encoding='utf8').read()
css = open(a.css, encoding='utf8').read() if a.css else ''
js = open(a.js, encoding='utf8').read() if a.js else ''

ctx = WebKit2.WebContext.new_ephemeral()
ucm = WebKit2.UserContentManager()
ucm.register_script_message_handler('perf')
bridge = "window.__perfPost = (m) => window.webkit.messageHandlers.perf.postMessage(JSON.stringify(m));"
for src in (bridge, scenarios_src):
    ucm.add_script(WebKit2.UserScript.new(src, WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
view = WebKit2.WebView(web_context=ctx, user_content_manager=ucm)
win = Gtk.Window()
win.set_default_size(a.width, a.height)
win.add(view)
win.show_all()
win.resize(a.width, a.height)

result = {'engine': 'webkitgtk %d.%d.%d' % (WebKit2.get_major_version(), WebKit2.get_minor_version(), WebKit2.get_micro_version()), 'scenarios': {}, 'info': None}
state = {'done': False}


grab = {'p': None}


def grab_start():
    if not a.grab:
        return
    import os, subprocess
    size, _, rest = a.grab.partition('+')
    x, _, y = rest.partition('+')
    grab['p'] = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', str(a.grab_fps), '-video_size', size,
                                  '-i', '%s+%s,%s' % (os.environ['DISPLAY'], x, y), '-c:v', 'libx264', '-crf', '10', '-preset', 'ultrafast', '-pix_fmt', 'yuv444p', a.out + '.mkv'],
                                 stdin=subprocess.PIPE)


def grab_stop():
    p = grab['p']
    if p:
        try:
            p.stdin.write(b'q')
            p.stdin.flush()
            p.wait(timeout=20)
        except Exception:  # noqa: BLE001
            p.kill()


def run_js(src):
    view.evaluate_javascript(src, -1, None, None, None, None, None)


def finish(code=0):
    if state['done']:
        return
    state['done'] = True
    grab_stop()
    open(a.out, 'w', encoding='utf8').write(json.dumps(result))
    Gtk.main_quit()
    if code:
        sys.exit(code)


def on_message(_ucm, jsr):
    try:
        msg = json.loads(jsr.get_js_value().to_string())
    except Exception as e:  # noqa: BLE001
        print('bad message', e, file=sys.stderr)
        return
    t = msg.get('type')
    if t == 'native' and msg.get('op') == 'resize':
        args, mid = msg['args'], msg['id']
        step = {'i': 0}

        def tick():
            step['i'] += 1
            f = step['i'] / args['steps']
            w = int(args['from'] + (args['to'] - args['from']) * f)
            win.resize(w, a.height)
            if step['i'] >= args['steps']:
                run_js('window.__perfNativeDone(%d)' % mid)
                return False
            return True
        GLib.timeout_add(args['ms'], tick)
    elif t == 'result':
        result['scenarios'][msg['name']] = msg['data']
        print('done', msg['name'], file=sys.stderr, flush=True)
    elif t == 'info':
        result['info'] = msg['data']
    elif t == 'done':
        finish()
    elif t == 'log':
        if msg.get('text') == 'ready':
            start_run()
        elif msg.get('text') != 'waiting':
            print(msg.get('text'), file=sys.stderr)


ucm.connect('script-message-received::perf', on_message)


started = {'v': False}


def boot_poll():
    run_js("""(async()=>{ const ok = !!(window.__hx && document.querySelector('#hx-dock .dk-row') && !document.getElementById('hx-app').classList.contains('is-booting'));
      if(ok) window.__perfPost({type:'log', text:'ready'}); else window.__perfPost({type:'log', text:'waiting'}); })()""")
    return True


def start_run():
    if started['v']:
        return
    started['v'] = True
    grab_start()
    names = json.dumps(a.scenarios.split(','))
    variant = json.dumps({'css': css, 'js': js})
    run_js("""(async()=>{
      try {
        const V = %s;
        if (V.css) { const s = document.createElement('style'); s.id='perf-variant'; s.textContent = V.css; document.head.appendChild(s); }
        if (V.js) { (0, eval)(V.js); }
        await __perf.sleep(1500);
        window.__perfPost({type:'info', data: __perf.info()});
        for (const n of %s) { const r = await __perf.run(n); window.__perfPost({type:'result', name:n, data:r}); }
        window.__perfPost({type:'info', data: Object.assign(__perf.info(), {after:true})});
      } catch(e) { window.__perfPost({type:'log', text:'ERROR '+(e&&e.stack||e)}); }
      window.__perfPost({type:'done'});
    })()""" % (variant, names))


def on_load(_v, ev):
    if ev == WebKit2.LoadEvent.FINISHED:
        GLib.timeout_add(500, lambda: (boot_poll(), not started['v'])[1])


view.connect('load-changed', on_load)
GLib.timeout_add_seconds(a.timeout, lambda: (print('timeout', file=sys.stderr), finish(2)))
view.load_uri(a.url)
Gtk.main()
