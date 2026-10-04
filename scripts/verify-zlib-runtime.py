"""Check the installed compression library and blocked gzip writes offline."""
import ctypes
import gzip
import os


library = ctypes.CDLL("libz.so.1")
library.zlibVersion.restype = ctypes.c_char_p
library.gzdopen.argtypes = [ctypes.c_int, ctypes.c_char_p]
library.gzdopen.restype = ctypes.c_void_p
library.gzbuffer.argtypes = [ctypes.c_void_p, ctypes.c_uint]
library.gzwrite.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint]
library.gzwrite.restype = ctypes.c_int
library.gzclearerr.argtypes = [ctypes.c_void_p]
library.gzprintf.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
library.gzprintf.restype = ctypes.c_int
library.gzclose.argtypes = [ctypes.c_void_p]
assert library.zlibVersion() == b"1.3.2.1-motley"

data = b"normal gzip round trip" * 1024
assert gzip.decompress(gzip.compress(data)) == data

for mode in (b"wT", b"w0", b"w"):
    reader, writer = os.pipe2(os.O_NONBLOCK)
    try:
        while True:
            os.write(writer, b"x" * 4096)
    except BlockingIOError:
        pass
    stream = library.gzdopen(writer, mode)
    assert stream
    try:
        assert library.gzbuffer(stream, 128) == 0
        payload = ctypes.create_string_buffer(os.urandom(65536))
        assert library.gzwrite(stream, payload, 65536) == 0
        library.gzclearerr(stream)
        results = [library.gzprintf(stream, b"%s", b"x" * 120) for _ in range(3)]
        assert results[-1] <= 0, "A blocked formatted write must fail without corrupting the buffer"
    finally:
        library.gzclose(stream)
        os.close(reader)

print("zlib runtime passed: real library version, gzip round trip and three blocked-write modes.")
