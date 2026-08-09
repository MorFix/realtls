#!/usr/bin/env python3
import struct, sys, json

ch = open(sys.argv[1], "rb").read()
assert ch[0] == 0x01, "not a ClientHello"
p = 4  # skip handshake type(1)+len(3)
legacy_version = ch[p:p+2].hex(); p += 2
random = ch[p:p+32].hex(); p += 32
sid_len = ch[p]; p += 1
session_id = ch[p:p+sid_len].hex(); p += sid_len
cs_len = struct.unpack(">H", ch[p:p+2])[0]; p += 2
ciphers = [struct.unpack(">H", ch[p+i:p+i+2])[0] for i in range(0, cs_len, 2)]; p += cs_len
comp_len = ch[p]; p += 1
comps = list(ch[p:p+comp_len]); p += comp_len
ext_total = struct.unpack(">H", ch[p:p+2])[0]; p += 2
end = p + ext_total
exts = []
while p < end:
    etype = struct.unpack(">H", ch[p:p+2])[0]; p += 2
    elen = struct.unpack(">H", ch[p:p+2])[0]; p += 2
    edata = ch[p:p+elen]; p += elen
    exts.append((etype, edata))

def is_grease(v): return (v & 0x0f0f) == 0x0a0a and (v >> 8) == (v & 0xff)

print("legacy_version:", legacy_version)
print("cipher_suites (%d):" % len(ciphers))
print("  ", [("GREASE" if is_grease(c) else hex(c)) for c in ciphers])
print("compression:", comps)
print("extensions in WIRE ORDER (%d):" % len(exts))
for etype, edata in exts:
    tag = "GREASE" if is_grease(etype) else etype
    extra = ""
    if etype == 13:  # sig algs
        n = struct.unpack(">H", edata[0:2])[0]
        algs = [edata[2+i:2+i+2].hex() for i in range(0, n, 2)]
        extra = " sigalgs=" + ",".join(algs)
    elif etype == 10:  # supported groups
        n = struct.unpack(">H", edata[0:2])[0]
        gs = [struct.unpack(">H", edata[2+i:2+i+2])[0] for i in range(0, n, 2)]
        extra = " groups=" + ",".join(("GREASE" if is_grease(g) else str(g)) for g in gs)
    elif etype == 43:  # supported versions
        n = edata[0]
        vs = [edata[1+i:1+i+2].hex() for i in range(0, n, 2)]
        extra = " versions=" + ",".join(vs)
    elif etype == 51:  # key share
        n = struct.unpack(">H", edata[0:2])[0]
        q = 2; shares = []
        while q < 2+n:
            grp = struct.unpack(">H", edata[q:q+2])[0]; q += 2
            kl = struct.unpack(">H", edata[q:q+2])[0]; q += 2
            shares.append(("GREASE" if is_grease(grp) else grp, kl)); q += kl
        extra = " shares=" + ",".join(f"{g}({l}B)" for g,l in shares)
    elif etype == 16:  # ALPN
        extra = " alpn=" + repr(edata[2:])
    elif etype == 0:  # SNI
        extra = " sni=" + repr(edata[5:])
    elif etype == 45:
        extra = " psk_modes=" + edata.hex()
    elif etype == 27:
        extra = " certcompress=" + edata.hex()
    elif etype == 17613:
        extra = " ALPS=" + repr(edata)
    elif etype == 65037:
        extra = " ECH_len=%d" % len(edata)
    print(f"  type={tag} len={len(edata)}{extra}")

# JA3 string
ja3_ciphers = "-".join(str(c) for c in ciphers if not is_grease(c))
ja3_exts = "-".join(str(e) for e,_ in exts if not is_grease(e))
print("\nJA3 ext order (no GREASE):", ja3_exts)
