#!/usr/bin/env python3
"""Minimal pcap + TCP reassembly + TLS ClientHello extractor. No deps."""
import struct, sys, json

def read_pcap(path):
    with open(path, "rb") as f:
        data = f.read()
    magic = struct.unpack("<I", data[:4])[0]
    if magic == 0xa1b2c3d4:
        endian = "<"; nano = False
    elif magic == 0xd4c3b2a1:
        endian = ">"; nano = False
    elif magic == 0xa1b23c4d:
        endian = "<"; nano = True
    elif magic == 0x4d3cb2a1:
        endian = ">"; nano = True
    else:
        raise SystemExit(f"bad magic {magic:#x}")
    off = 24
    pkts = []
    while off + 16 <= len(data):
        ts_sec, ts_usec, incl, orig = struct.unpack(endian + "IIII", data[off:off+16])
        off += 16
        pkts.append(data[off:off+incl])
        off += incl
    return pkts

def parse_eth(pkt):
    # Ethernet II
    if len(pkt) < 14: return None
    eth_type = struct.unpack(">H", pkt[12:14])[0]
    if eth_type == 0x0800:
        return pkt[14:]
    # possibly a loopback/null header; try raw IPv4
    return None

def parse_ipv4(p):
    if len(p) < 20: return None
    ver_ihl = p[0]
    if (ver_ihl >> 4) != 4: return None
    ihl = (ver_ihl & 0xf) * 4
    proto = p[9]
    if proto != 6: return None  # TCP
    src = ".".join(map(str, p[12:16]))
    dst = ".".join(map(str, p[16:20]))
    total = struct.unpack(">H", p[2:4])[0]
    return src, dst, p[ihl:total]

def parse_tcp(seg):
    if len(seg) < 20: return None
    sport, dport = struct.unpack(">HH", seg[0:4])
    seq = struct.unpack(">I", seg[4:8])[0]
    off = (seg[12] >> 4) * 4
    return sport, dport, seq, seg[off:]

# Reassemble per-flow payload by seq
flows = {}
for pkt in read_pcap(sys.argv[1]):
    ip = parse_eth(pkt)
    if ip is None: continue
    r = parse_ipv4(ip)
    if r is None: continue
    src, dst, seg = r
    t = parse_tcp(seg)
    if t is None: continue
    sport, dport, seq, payload = t
    if not payload: continue
    key = (src, sport, dst, dport)
    flows.setdefault(key, {})[seq] = payload

def find_client_hello(buf):
    # scan for TLS record: 0x16 0x03 0x01, then handshake 0x01 (ClientHello)
    i = 0
    while i + 6 < len(buf):
        if buf[i] == 0x16 and buf[i+1] == 0x03 and buf[i+2] in (0x01,0x03) and buf[i+5] == 0x01:
            rec_len = struct.unpack(">H", buf[i+3:i+5])[0]
            hs_len = struct.unpack(">I", b"\x00"+buf[i+6:i+9])[0]
            record = buf[i+5:i+5+hs_len+4]
            return record  # handshake message (starts with 0x01)
        i += 1
    return None

results = []
for key, segs in flows.items():
    ordered = b"".join(segs[s] for s in sorted(segs))
    ch = find_client_hello(ordered)
    if ch:
        src, sport, dst, dport = key
        results.append((f"{src}:{sport}->{dst}:{dport}", ch))

print(f"found {len(results)} ClientHello(s)")
for name, ch in results:
    print(name, "len", len(ch))
# dedup by bytes, dump the first/full one
if results:
    # dump the longest (most complete) one
    name, ch = max(results, key=lambda r: len(r[1]))
    with open(sys.argv[2], "wb") as f:
        f.write(ch)
    print("wrote", sys.argv[2], "bytes", len(ch), "from", name)
    print("hex head:", ch[:16].hex())
