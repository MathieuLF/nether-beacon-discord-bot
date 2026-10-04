# Runtime-compatible upstream snapshot for CVE-2026-85091.
pkgname=zlib
pkgver=1.3.2.1_git20260917
pkgrel=0
pkgdesc="Compression library with upstream non-blocking gzip write fixes"
url="https://zlib.net/"
arch="all"
license="Zlib"
source="zlib.tar.gz"
builddir="$srcdir/zlib-d81c2d7eb705c62294ba03299255672078e89115"

build() {
    ./configure --prefix=/usr
    make
}

check() {
    make check
}

package() {
    make DESTDIR="$pkgdir" install
    rm -rf "$pkgdir/usr/include" "$pkgdir/usr/share/man" "$pkgdir/usr/lib/pkgconfig"
    rm "$pkgdir/usr/lib/libz.a" "$pkgdir/usr/lib/libz.so"
    install -Dm644 LICENSE "$pkgdir/usr/share/licenses/zlib/LICENSE"
}

sha512sums="0cc5c560528ac19c5e46e866f861e63cec22bf841c5899314fc08ff5698cbd95737db9a1fcd89443b2ad6b2b628be55cf9963168462fb2ad63f119ca045ef525  zlib.tar.gz"
