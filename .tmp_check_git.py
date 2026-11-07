import zlib

p = "/Volumes/extension/Projects/agasocial/iaable/iablee-app/.git/objects/ba/2d2bfcca5a06b32f0ce81ac6f173f4c1cbf0e0"
with open(p, "rb") as f:
    data = zlib.decompress(f.read())
print(data[:3000].decode("utf-8", "replace"))

idx = "/Volumes/extension/Projects/agasocial/iaable/iablee-app/.git/index"
with open(idx, "rb") as f:
    b = f.read()
for s in [b"supabase/.temp", b"linked-project", b"cli-latest", b"project-ref"]:
    print(repr(s), s in b)
