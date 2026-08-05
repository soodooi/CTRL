# CTRL LibreOffice Companion: explicit-selection, read-only UNO boundary.
# Python is application-owned extension code, never an MCP runtime.
# (ADR-002 substrate §14 v78; ADR-010 communication § trust-domains v13)

import atexit
import ctypes
import hashlib
import hmac
import json
import os
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import uno
import unohelper
from com.sun.star.awt import XCallback
from com.sun.star.task import XJobExecutor
from com.sun.star.util import XModifyListener


_KEYCHAIN_SERVICE = "app.ctrl"
_KEYCHAIN_ACCOUNT = "libreoffice-bridge"
_PROTOCOL_VERSION = "1"
_MAX_RESPONSE_BYTES = 1024 * 1024
_SERVER = None
_SERVER_THREAD = None
_TOKEN = None
_DESKTOP = None
_ASYNC_CALLBACK = None
_STATE_LOCK = threading.RLock()
_REVISIONS = {}
_LISTENERS = {}


class SelectionUnavailable(Exception):
    pass


class _ModificationListener(unohelper.Base, XModifyListener):
    def __init__(self, document_id):
        self.document_id = document_id

    def modified(self, _event):
        with _STATE_LOCK:
            _REVISIONS[self.document_id] = _REVISIONS.get(self.document_id, 0) + 1

    def disposing(self, _event):
        with _STATE_LOCK:
            _LISTENERS.pop(self.document_id, None)
            _REVISIONS.pop(self.document_id, None)


class _SelectionCallback(unohelper.Base, XCallback):
    def __init__(self):
        self.event = threading.Event()
        self.payload = None
        self.error = None

    def notify(self, _data):
        try:
            self.payload = _read_selected_context()
        except Exception as error:
            self.error = error
        finally:
            self.event.set()


def _read_selected_context_on_ui_thread():
    if _ASYNC_CALLBACK is None:
        raise SelectionUnavailable("LibreOffice callback service is unavailable")
    callback = _SelectionCallback()
    _ASYNC_CALLBACK.addCallback(callback, None)
    if not callback.event.wait(3):
        raise SelectionUnavailable("LibreOffice did not return the live selection")
    if callback.error is not None:
        raise callback.error
    return callback.payload


class _BridgeHandler(BaseHTTPRequestHandler):
    server_version = "CTRL-LibreOffice-Bridge"
    sys_version = ""

    def do_GET(self):
        if self.path != "/selection":
            self._write_json(404, {"error": {"code": "not_found", "message": "Not found"}})
            return
        supplied = self.headers.get("Authorization", "")
        expected = "Bearer " + _TOKEN
        if not hmac.compare_digest(supplied, expected):
            self._write_json(
                401,
                {"error": {"code": "unauthorized", "message": "Bridge authentication failed"}},
            )
            return
        try:
            payload = _read_selected_context_on_ui_thread()
            self._write_json(200, payload)
        except SelectionUnavailable as error:
            self._write_json(
                409,
                {"error": {"code": "selection_unavailable", "message": str(error)}},
            )
        except Exception:
            self._write_json(
                503,
                {"error": {"code": "bridge_unavailable", "message": "Live selection is unavailable"}},
            )

    def _write_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(body) > _MAX_RESPONSE_BYTES:
            status = 413
            body = b'{"error":{"code":"selection_too_large","message":"Selection is too large"}}'
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        # Never log authorization headers, selected content, or document metadata.
        return


class _LoopbackServer(ThreadingHTTPServer):
    allow_reuse_address = False
    daemon_threads = True


def _read_keychain_token():
    # The extension and CTRL share one dedicated Keychain item. On first enable,
    # the extension creates it before publishing rendezvous metadata; CTRL later
    # reads it only after binding that metadata to this signed LibreOffice
    # process. The credential exists only in Keychain and process memory.
    # (ADR-010 communication § trust-domains v13)
    security = ctypes.CDLL(
        "/System/Library/Frameworks/Security.framework/Security"
    )
    find_password = security.SecKeychainFindGenericPassword
    find_password.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_char_p,
        ctypes.c_uint32,
        ctypes.c_char_p,
        ctypes.POINTER(ctypes.c_uint32),
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.c_void_p,
    ]
    find_password.restype = ctypes.c_int32
    add_password = security.SecKeychainAddGenericPassword
    add_password.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_char_p,
        ctypes.c_uint32,
        ctypes.c_char_p,
        ctypes.c_uint32,
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]
    add_password.restype = ctypes.c_int32
    free_content = security.SecKeychainItemFreeContent
    free_content.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    free_content.restype = ctypes.c_int32
    service = _KEYCHAIN_SERVICE.encode("utf-8")
    account = _KEYCHAIN_ACCOUNT.encode("utf-8")

    def find_existing():
        length = ctypes.c_uint32()
        data = ctypes.c_void_p()
        status = find_password(
            None,
            len(service),
            service,
            len(account),
            account,
            ctypes.byref(length),
            ctypes.byref(data),
            None,
        )
        if status != 0 or not data.value or length.value == 0:
            return status, None
        try:
            return status, ctypes.string_at(data, length.value).decode("utf-8").strip()
        finally:
            free_content(None, data)

    status, token = find_existing()
    if status == 0 and token:
        return token

    # errSecItemNotFound. Any other status is an authorization/keychain failure,
    # not permission to replace an existing credential.
    if status != -25300:
        raise RuntimeError("CTRL Companion credential is unavailable")
    candidate = secrets.token_hex(32)
    candidate_bytes = candidate.encode("utf-8")
    candidate_buffer = ctypes.create_string_buffer(candidate_bytes)
    add_status = add_password(
        None,
        len(service),
        service,
        len(account),
        account,
        len(candidate_bytes),
        ctypes.cast(candidate_buffer, ctypes.c_void_p),
        None,
    )
    if add_status == 0:
        return candidate
    # A concurrent first-enable may have won the create race. Read its value;
    # never overwrite or disclose it through files, arguments, or logs.
    if add_status == -25299:  # errSecDuplicateItem
        _status, existing = find_existing()
        if _status == 0 and existing:
            return existing
    raise RuntimeError("CTRL Companion credential could not be created")


def _runtime_paths():
    run_directory = os.path.join(os.path.expanduser("~"), ".ctrl", "run")
    rendezvous = os.path.join(run_directory, "libreoffice-bridge.json")
    return run_directory, rendezvous


def _publish_rendezvous(port):
    run_directory, rendezvous = _runtime_paths()
    if os.path.lexists(run_directory) and os.path.islink(run_directory):
        raise RuntimeError("CTRL runtime directory must not be a symbolic link")
    os.makedirs(run_directory, mode=0o700, exist_ok=True)
    os.chmod(run_directory, 0o700)
    temporary = rendezvous + ".%d.tmp" % os.getpid()
    payload = {
        "schema_version": 1,
        "protocol_version": _PROTOCOL_VERSION,
        "pid": os.getpid(),
        "port": port,
    }
    encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, rendezvous)
        os.chmod(rendezvous, 0o600)
        directory_fd = os.open(run_directory, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def _remove_rendezvous_for_server(server):
    _run_directory, rendezvous = _runtime_paths()
    try:
        with open(rendezvous, "r", encoding="utf-8") as stream:
            payload = json.load(stream)
        if payload.get("pid") == os.getpid() and server is not None:
            if payload.get("port") == server.server_address[1]:
                os.unlink(rendezvous)
    except (FileNotFoundError, OSError, ValueError):
        pass


def _remove_own_rendezvous():
    _remove_rendezvous_for_server(_SERVER)


def _document_identity(document):
    runtime_uid = str(getattr(document, "RuntimeUID", "") or "")
    if not runtime_uid:
        runtime_uid = str(getattr(document, "URL", "") or getattr(document, "Title", ""))
    if not runtime_uid:
        runtime_uid = "untitled:%d" % id(document)
    return "sha256:" + hashlib.sha256(runtime_uid.encode("utf-8")).hexdigest()


def _ensure_revision_listener(document, document_id):
    with _STATE_LOCK:
        if document_id not in _LISTENERS:
            listener = _ModificationListener(document_id)
            document.addModifyListener(listener)
            _LISTENERS[document_id] = (document, listener)
            _REVISIONS.setdefault(document_id, 0)
        return str(_REVISIONS[document_id])


def _content_hash(document_type, target, content, formulas):
    canonical = json.dumps(
        {
            "document_type": document_type,
            "target": target,
            "content": content,
            "formulas": formulas,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


def _writer_selection(document):
    selections = document.getCurrentSelection()
    if selections is None or not hasattr(selections, "getCount") or selections.getCount() != 1:
        raise SelectionUnavailable("Select one Writer text range")
    selection = selections.getByIndex(0)
    content = selection.getString()
    if not content:
        raise SelectionUnavailable("Select non-empty Writer text")
    text = document.Text
    start_cursor = text.createTextCursorByRange(text.Start)
    start_cursor.gotoRange(selection.Start, True)
    end_cursor = text.createTextCursorByRange(text.Start)
    end_cursor.gotoRange(selection.End, True)
    start = len(start_cursor.String)
    end = len(end_cursor.String)
    return "writer:chars:%d-%d" % (start, end), content, None


def _column_name(index):
    name = ""
    value = index + 1
    while value:
        value, remainder = divmod(value - 1, 26)
        name = chr(65 + remainder) + name
    return name


def _calc_selection(document):
    selection = document.getCurrentSelection()
    if selection is None or not hasattr(selection, "getRangeAddress"):
        raise SelectionUnavailable("Select a Calc cell range")
    address = selection.getRangeAddress()
    if address.StartColumn == address.EndColumn and address.StartRow == address.EndRow:
        raise SelectionUnavailable("Select at least two Calc cells")
    sheet = document.Sheets.getByIndex(address.Sheet).Name.replace("'", "''")
    start = "$%s$%d" % (_column_name(address.StartColumn), address.StartRow + 1)
    end = "$%s$%d" % (_column_name(address.EndColumn), address.EndRow + 1)
    target = "'%s'.%s:%s" % (sheet, start, end)
    content = [list(row) for row in selection.getDataArray()]
    formulas = [list(row) for row in selection.getFormulaArray()]
    return target, content, formulas


def _read_selected_context():
    document = _DESKTOP.getCurrentComponent() if _DESKTOP is not None else None
    if document is None:
        raise SelectionUnavailable("No active LibreOffice document")
    document_id = _document_identity(document)
    revision = _ensure_revision_listener(document, document_id)
    if document.supportsService("com.sun.star.text.TextDocument"):
        document_type = "writer"
        selection_kind = "writer_selection"
        target, content, formulas = _writer_selection(document)
    elif document.supportsService("com.sun.star.sheet.SpreadsheetDocument"):
        document_type = "calc"
        selection_kind = "calc_range"
        target, content, formulas = _calc_selection(document)
    else:
        raise SelectionUnavailable("Only Writer and Calc are supported")
    return {
        "document_id": document_id,
        "document_type": document_type,
        "revision": revision,
        "selection_kind": selection_kind,
        "target": target,
        "content": content,
        "formulas": formulas,
        "content_hash": _content_hash(document_type, target, content, formulas),
    }


def start_companion(desktop=None, async_callback=None, *_args):
    global _SERVER, _SERVER_THREAD, _TOKEN, _DESKTOP, _ASYNC_CALLBACK
    with _STATE_LOCK:
        if _SERVER is not None:
            return "CTRL Companion is already enabled"
        if desktop is None or async_callback is None:
            raise RuntimeError("LibreOffice desktop context is unavailable")

        server = None
        try:
            token = _read_keychain_token()
            server = _LoopbackServer(("127.0.0.1", 0), _BridgeHandler)
            _publish_rendezvous(server.server_address[1])
            thread = threading.Thread(
                target=server.serve_forever,
                name="ctrl-libreoffice-bridge",
                daemon=True,
            )

            # Publish process-local state before the thread can accept a request.
            # If thread startup fails, every resource and global is rolled back so
            # Enable remains retryable. (ADR-010 communication § transports v13)
            _TOKEN = token
            _DESKTOP = desktop
            _ASYNC_CALLBACK = async_callback
            _SERVER = server
            _SERVER_THREAD = thread
            thread.start()
        except Exception:
            _remove_rendezvous_for_server(server)
            if server is not None:
                server.server_close()
            _SERVER = None
            _SERVER_THREAD = None
            _TOKEN = None
            _DESKTOP = None
            _ASYNC_CALLBACK = None
            raise
    return "CTRL Companion enabled"


def stop_companion(*_args):
    global _SERVER, _SERVER_THREAD, _TOKEN, _DESKTOP, _ASYNC_CALLBACK
    with _STATE_LOCK:
        server = _SERVER
        if server is None:
            return "CTRL Companion is already disabled"
        _remove_own_rendezvous()
        server.shutdown()
        server.server_close()
        _SERVER = None
        _SERVER_THREAD = None
        _TOKEN = None
        _DESKTOP = None
        _ASYNC_CALLBACK = None
    return "CTRL Companion disabled"


class CompanionJob(unohelper.Base, XJobExecutor):
    def __init__(self, context):
        self.context = context
        self.desktop = context.ServiceManager.createInstanceWithContext(
            "com.sun.star.frame.Desktop", context
        )
        self.async_callback = context.ServiceManager.createInstanceWithContext(
            "com.sun.star.awt.AsyncCallback", context
        )

    def trigger(self, command):
        try:
            if command == "enable":
                message = start_companion(self.desktop, self.async_callback)
            elif command == "disable":
                message = stop_companion()
            else:
                message = "Unsupported CTRL Companion command"
        except Exception as error:
            message = str(error) or "CTRL Companion is unavailable"
        self._notify(message)

    def _notify(self, message):
        frame = self.desktop.ActiveFrame
        if frame is None:
            return
        window = frame.ContainerWindow
        box = window.Toolkit.createMessageBox(
            window,
            uno.Enum("com.sun.star.awt.MessageBoxType", "INFOBOX"),
            uno.getConstantByName("com.sun.star.awt.MessageBoxButtons.BUTTONS_OK"),
            "CTRL Companion",
            message,
        )
        box.execute()


def _shutdown_at_exit():
    try:
        stop_companion()
    except Exception:
        pass


atexit.register(_shutdown_at_exit)
g_ImplementationHelper = unohelper.ImplementationHelper()
g_ImplementationHelper.addImplementation(
    CompanionJob,
    "app.ctrl.libreoffice.Companion",
    ("com.sun.star.task.Job",),
)
