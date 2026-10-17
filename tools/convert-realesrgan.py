"""
Convert the Real-ESRGAN "general_fast" tf.js model shipped in @plotdb/upscaler
(realesr-general-x4v3 blended 50/50 with realesr-general-wdn-x4v3, BSD-3-Clause)
to ONNX for ONNX Runtime Web. The network is SRVGGNetCompact: 33 conv+PReLU
layers, a final conv, pixel shuffle, plus a nearest-neighbour 4x skip.

Usage: python3 tools/convert-realesrgan.py <path>/models/realesrgan/general_fast-64 models/realesr-general-x4.onnx
Needs: pip install onnx numpy
"""
import json, sys, numpy as np, onnx
from onnx import helper as h, TensorProto as T, numpy_helper as nh
src, out = sys.argv[1], sys.argv[2]
m = json.load(open(f'{src}/model.json'))
buf = open(f'{src}/group1-shard1of1.bin', 'rb').read()
W, off = {}, 0
for w in m['weightsManifest'][0]['weights']:
    n = int(np.prod(w['shape'])) if w['shape'] else 1
    q = w.get('quantization')
    dt = np.float16 if q and q['dtype'] == 'float16' else {'float32': np.float32, 'int32': np.int32}[w['dtype']]
    a = np.frombuffer(buf, dt, n, off).reshape(w['shape']).astype(np.float32 if dt == np.float16 else dt)
    off += n * np.dtype(dt).itemsize
    W[w['name']] = a
nodes, inits, x = [], [], 'input'
for nd in m['modelTopology']['node']:
    if nd['op'] != '_FusedConv2D': continue
    ins = nd['input']; name = nd['name']
    k = W[ins[1]].transpose(3, 2, 0, 1)  # HWIO -> OIHW
    inits += [nh.from_array(k, name + '_w'), nh.from_array(W[ins[2]], name + '_b')]
    y = name + '_conv'
    nodes.append(h.make_node('Conv', [x, name + '_w', name + '_b'], [y], pads=[1, 1, 1, 1], kernel_shape=[3, 3]))
    if len(ins) == 4:
        inits.append(nh.from_array(W[ins[3]].reshape(-1, 1, 1), name + '_a'))
        nodes.append(h.make_node('PRelu', [y, name + '_a'], [name + '_act'])); y = name + '_act'
    x = y
nodes.append(h.make_node('DepthToSpace', [x], ['d2s'], blocksize=4, mode='DCR'))
inits.append(nh.from_array(np.array([1, 1, 4, 4], np.float32), 'scales'))
nodes.append(h.make_node('Resize', ['input', '', 'scales'], ['up'], mode='nearest', nearest_mode='floor', coordinate_transformation_mode='asymmetric'))
nodes.append(h.make_node('Add', ['d2s', 'up'], ['output']))
g = h.make_graph(nodes, 'realesr_general_x4', [h.make_tensor_value_info('input', T.FLOAT, [1, 3, 'h', 'w'])],
                 [h.make_tensor_value_info('output', T.FLOAT, [1, 3, 'H', 'W'])], inits)
model = h.make_model(g, opset_imports=[h.make_opsetid('', 17)], ir_version=8)
onnx.checker.check_model(model)
onnx.save(model, out)
print('ok', len(nodes), sum(i.ByteSize() for i in inits))
