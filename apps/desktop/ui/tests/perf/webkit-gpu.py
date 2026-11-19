#!/usr/bin/python3.12
"""Print WebKitGTK's own `webkit://gpu` page as text: the version, the buffer path (DMABUF or shared memory), the
acceleration policy and the GL/EGL vendor. Run under Xvfb like webkit-runner.py, or on a real display."""
import sys
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, GLib, WebKit2  # noqa: E402

view = WebKit2.WebView()
win = Gtk.Window()
win.set_default_size(900, 700)
win.add(view)
win.show_all()


def done(_v, ev):
    if ev != WebKit2.LoadEvent.FINISHED:
        return

    def grab():
        view.evaluate_javascript('document.body.innerText', -1, None, None, None, on_text, None)
        return False
    GLib.timeout_add(800, grab)


def on_text(v, res, _u):
    val = v.evaluate_javascript_finish(res)
    print(val.to_string())
    Gtk.main_quit()


view.connect('load-changed', done)
GLib.timeout_add_seconds(20, lambda: (print('timeout', file=sys.stderr), Gtk.main_quit()))
view.load_uri('webkit://gpu')
Gtk.main()
