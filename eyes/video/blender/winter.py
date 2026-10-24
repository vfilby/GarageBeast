# Santa's sleigh across the moon — a cartoon loop for the garage doors, built and rendered headless in Blender.
#
#   blender -b -y -P winter.py -- --scene bg|sleigh|all [--out DIR] [--frames N] [--samples N] [--preview]   (-y: driver expressions)
#
# The show is a persistent winter night (--scene bg, a 20 s loop) with events layered on it by show.html: --scene sleigh
# renders the train alone on a transparent film (15 s, RGBA) for a VP9-alpha clip; more events (a snowman, a snowball
# fight) follow the same pattern. --scene all is the original single clip with everything in it.
#
# One wide scene across both doors (2352×896 = two 1152×896 doors + the 4 % post), 20 s at 30 fps, seamless: the
# train is off-screen at both ends, everything else is still or moves in whole periods. Orthographic camera; world
# units: a door is 10 tall, the scene 26.25 wide; x<−0.27 is the left door, x>0.27 the right.
#
# The look is a classic animated Christmas special: cel shading (Shader-to-RGB → 3-tone ramp) with dark ink outlines
# (Freestyle) on the train, a cool moonlight key and a warm lantern fill; a cream cartoon moon with craters and a soft
# halo, twinkling four-point stars, light snow, a snowy hill with pines along the bottom. The reindeer lope (hips,
# knees, hooves, a bob and a head nod on drivers, each deer a quarter-cycle behind the one ahead), the sleigh follows
# through, Santa waves, and the sleigh trails spinning gold sparkles. Encode with encode.sh.
import bpy, math, random, sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(k, d): return argv[argv.index(k) + 1] if k in argv else d
SCENE = arg('--scene', 'all')          # bg: the winter night loop (sky, moon, snow, hill) | sleigh: the train alone on a
                                       # transparent film, to be layered over the loop as an event | all: both, one clip
BG = SCENE in ('bg', 'all'); TRAIN = SCENE in ('sleigh', 'all')
OUT = arg('--out', '/tmp/' + SCENE)
FRAMES = int(arg('--frames', 460 if SCENE == 'sleigh' else 600))
START, END = int(arg('--start', 1)), int(arg('--end', 0)) or None   # render a chunk (long Freestyle runs grow in memory)
SAMPLES = int(arg('--samples', 24))
PREVIEW = '--preview' in argv
FPS = 30
W, H = 2352, 896
UNIT_H = 10.0
UNIT_W = UNIT_H * W / H
random.seed(11)
TAU = 2 * math.pi

# ---------- scene ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
s = bpy.context.scene
s.render.engine = 'BLENDER_EEVEE'
s.render.resolution_x, s.render.resolution_y, s.render.resolution_percentage = W, H, 100
s.render.fps = FPS; s.frame_start, s.frame_end = START, END or FRAMES
s.eevee.taa_render_samples = SAMPLES
s.render.image_settings.file_format = 'PNG'; s.render.image_settings.color_mode = 'RGBA' if SCENE == 'sleigh' else 'RGB'; s.render.image_settings.color_depth = '8'
s.render.film_transparent = SCENE == 'sleigh'
s.render.filepath = OUT.rstrip('/') + '/frame_'
s.view_settings.view_transform = 'Standard'; s.view_settings.look = 'None'
world = bpy.data.worlds.new('w'); s.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)

cam_data = bpy.data.cameras.new('cam'); cam_data.type = 'ORTHO'; cam_data.ortho_scale = UNIT_W
cam = bpy.data.objects.new('cam', cam_data); s.collection.objects.link(cam); s.camera = cam
cam.location = (0, -40, 0); cam.rotation_euler = (math.radians(90), 0, 0)

COL = {}
for name in ('train', 'sky', 'ground', 'fx'):
    c = bpy.data.collections.new(name); s.collection.children.link(c); COL[name] = c
def put(o, col):
    for c in list(o.users_collection): c.objects.unlink(o)
    COL[col].objects.link(o); return o

# lights: cool moonlight key from the upper right, a warm low fill from the front left
def sun(name, energy, color, rot):
    l = bpy.data.lights.new(name, 'SUN'); l.energy = energy; l.color = color; l.angle = 0.02
    o = bpy.data.objects.new(name, l); s.collection.objects.link(o); o.rotation_euler = rot; return o
sun('moonlight', 3.2, (0.80, 0.88, 1.0), (math.radians(35), math.radians(-25), math.radians(-30)))
sun('fill', 0.9, (1.0, 0.85, 0.65), (math.radians(60), math.radians(15), math.radians(35)))

# ---------- materials ----------
def out_node(m):
    n = m.node_tree.nodes; n.clear(); return n, m.node_tree.links, n.new('ShaderNodeOutputMaterial')

def cel(name, color, rim=0.0, rim_color=(1.0, 0.85, 0.5)):
    """three-tone cel shading of `color` under the scene lights, optional gold rim (moon backlight)"""
    m = bpy.data.materials.new(name); m.use_nodes = True
    n, L, out = out_node(m)
    dif = n.new('ShaderNodeBsdfDiffuse'); dif.inputs['Color'].default_value = (1, 1, 1, 1)
    s2r = n.new('ShaderNodeShaderToRGB')
    ramp = n.new('ShaderNodeValToRGB'); cr = ramp.color_ramp; cr.interpolation = 'CONSTANT'
    cr.elements[0].position = 0.0; cr.elements[0].color = (0.38, 0.36, 0.42, 1)
    cr.elements[1].position = 0.28; cr.elements[1].color = (0.72, 0.72, 0.74, 1)
    e = cr.elements.new(0.62); e.color = (1.0, 1.0, 1.0, 1)
    mul = n.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1.0
    mul.inputs[6].default_value = (*color, 1)
    em = n.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 1.0
    L.new(dif.outputs[0], s2r.inputs[0]); L.new(s2r.outputs['Color'], ramp.inputs['Fac']); L.new(ramp.outputs['Color'], mul.inputs[7])
    if rim > 0:
        lw = n.new('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.45
        pw = n.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 3.0
        rm = n.new('ShaderNodeMix'); rm.data_type = 'RGBA'; rm.blend_type = 'ADD'; rm.inputs[6].default_value = (*rim_color, 1)
        sc = n.new('ShaderNodeMath'); sc.operation = 'MULTIPLY'; sc.inputs[1].default_value = rim
        L.new(lw.outputs['Facing'], pw.inputs[0]); L.new(pw.outputs[0], sc.inputs[0]); L.new(sc.outputs[0], rm.inputs['Factor'])
        L.new(mul.outputs[2], rm.inputs[6]); rm.inputs[7].default_value = (*rim_color, 1)
        L.new(rm.outputs[2], em.inputs['Color'])
    else:
        L.new(mul.outputs[2], em.inputs['Color'])
    L.new(em.outputs[0], out.inputs[0])
    return m

def emissive(name, color, strength):
    m = bpy.data.materials.new(name); m.use_nodes = True
    n, L, out = out_node(m); e = n.new('ShaderNodeEmission')
    e.inputs['Color'].default_value = (*color, 1); e.inputs['Strength'].default_value = strength
    L.new(e.outputs[0], out.inputs[0]); return m

def halo_mat(name, color, strength, power=2.2):
    """soft radial glow on a plane (object coords), transparent at the edge"""
    m = bpy.data.materials.new(name); m.use_nodes = True; m.blend_method = 'BLEND'
    n, L, out = out_node(m)
    em = n.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (*color, 1); em.inputs['Strength'].default_value = strength
    tr = n.new('ShaderNodeBsdfTransparent'); mix = n.new('ShaderNodeMixShader')
    grad = n.new('ShaderNodeTexGradient'); grad.gradient_type = 'SPHERICAL'; co = n.new('ShaderNodeTexCoord')
    pw = n.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = power
    L.new(co.outputs['Object'], grad.inputs['Vector']); L.new(grad.outputs['Fac'], pw.inputs[0]); L.new(pw.outputs[0], mix.inputs['Fac'])
    L.new(tr.outputs[0], mix.inputs[1]); L.new(em.outputs[0], mix.inputs[2]); L.new(mix.outputs[0], out.inputs[0])
    return m

RED = cel('red', (0.78, 0.09, 0.10), rim=0.5)
RED_DARK = cel('red_dark', (0.55, 0.05, 0.07), rim=0.4)
GOLD = cel('gold', (0.95, 0.72, 0.22), rim=0.8)
BROWN = cel('brown', (0.55, 0.32, 0.16), rim=0.5)
BROWN_LIGHT = cel('brown_light', (0.76, 0.55, 0.34), rim=0.3)
BROWN_DARK = cel('brown_dark', (0.36, 0.20, 0.10), rim=0.2)     # the far-side legs, so the near pair reads in front
TAN = cel('tan', (0.85, 0.72, 0.50), rim=0.3)
DARK = cel('dark', (0.12, 0.08, 0.06), rim=0.3)
WHITE = cel('white', (0.96, 0.96, 0.98), rim=0.2)
SKIN = cel('skin', (0.98, 0.78, 0.62), rim=0.2)
GREEN = cel('green', (0.09, 0.32, 0.17), rim=0.0)
GREEN_DARK = cel('green_dark', (0.05, 0.20, 0.11), rim=0.0)
SNOW = cel('snow', (0.86, 0.92, 1.0), rim=0.0)
INK = emissive('ink', (0.05, 0.02, 0.02), 1.0); INK.use_backface_culling = True   # the inverted-hull outline shell
OUTLINE_W = 0.045   # world units ≈ 4 px at 2352 wide (ortho, 26.25 units across); the hull only shows outside the silhouette
def outline(o):
    """toon ink line: a flipped, inflated copy of the surface in the ink material (Solidify), drawn only where it faces
    away, so it shows as a constant-width rim around the silhouette — Eevee-cheap, unlike Freestyle"""
    if o.type != 'MESH': return
    o.data.materials.append(INK)
    m = o.modifiers.new("outline", "SOLIDIFY"); m.thickness = OUTLINE_W; m.offset = 1; m.use_flip_normals = True
    m.material_offset = 1; m.use_rim = False
EYE_WHITE = emissive('eye_white', (1, 1, 1), 1.0)
NOSE = emissive('nose', (1.0, 0.12, 0.06), 10)
LANTERN = emissive('lantern', (1.0, 0.75, 0.35), 8)
SPARK = emissive('spark', (1.0, 0.86, 0.45), 7)
STAR = emissive('star', (0.9, 0.93, 1.0), 3)
FLAKE = emissive('flake', (0.92, 0.95, 1.0), 2.2)

# ---------- helpers ----------
def empty(name, loc=(0, 0, 0), parent=None, col='train'):
    o = bpy.data.objects.new(name, None); o.location = loc; s.collection.objects.link(o); put(o, col)
    if parent: o.parent = parent
    return o
def prim(kind, name, loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), mat=RED, parent=None, col='train', smooth=True, **kw):
    getattr(bpy.ops.mesh, 'primitive_%s_add' % kind)(**kw)
    o = bpy.context.active_object; o.name = name
    o.location = loc; o.scale = scale; o.rotation_euler = rot
    if mat: o.data.materials.append(mat)
    if parent: o.parent = parent
    if smooth:
        bpy.ops.object.shade_smooth()
        if col == 'train':   # organic parts: subdivide so silhouettes and outlines are round at door size
            m = o.modifiers.new('subsurf', 'SUBSURF'); m.levels = 1; m.render_levels = 2
    if col == 'train': outline(o)
    return put(o, col)
def sphere(name, r, loc, scale=(1, 1, 1), parent=None, mat=RED, col='train'):
    return prim('uv_sphere', name, loc, (r * scale[0], r * scale[1], r * scale[2]), parent=parent, mat=mat, col=col, segments=32, ring_count=16)
def cyl(name, r, length, loc, rot, parent=None, mat=RED, col='train', r2=None):
    o = prim('cylinder', name, loc, (r, r, length / 2), rot, parent=parent, mat=mat, col=col, vertices=32)
    if r2 is not None:   # taper: scale the top ring
        for v in o.data.vertices:
            if v.co.z > 0: v.co.x *= r2 / r; v.co.y *= r2 / r
    return o
def cone(name, r, h, loc, rot=(0, 0, 0), parent=None, mat=GREEN, col='train'):
    return prim('cone', name, loc, (r, r, h / 2), rot, parent=parent, mat=mat, col=col, vertices=32)
def torus(name, R, r, loc, rot, parent=None, mat=GOLD, col='train', scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=48, minor_segments=16)
    o = bpy.context.active_object; o.name = name; o.location = loc; o.rotation_euler = rot; o.scale = scale
    o.data.materials.append(mat); bpy.ops.object.shade_smooth()
    if parent: o.parent = parent
    return put(o, col)
def profile(name, pts, thickness, mat, parent=None, col='train', y=0.0):
    """a flat side-view outline (x,z pairs) extruded across y with Solidify"""
    me = bpy.data.meshes.new(name); me.from_pydata([(x, 0, z) for x, z in pts], [], [list(range(len(pts)))]); me.update()
    o = bpy.data.objects.new(name, me); o.location = (0, y, 0); s.collection.objects.link(o); put(o, col)
    o.data.materials.append(mat); mod = o.modifiers.new('solid', 'SOLIDIFY'); mod.thickness = thickness; mod.offset = 0
    if parent: o.parent = parent
    if col == 'train': outline(o)
    return o
def curve(name, pts, depth, mat, parent=None, col='train', y=0.0, sag=0.0):
    cv = bpy.data.curves.new(name, 'CURVE'); cv.dimensions = '3D'; cv.bevel_depth = depth; cv.bevel_resolution = 8; cv.resolution_u = 24
    sp = cv.splines.new('BEZIER'); sp.bezier_points.add(len(pts) - 1)
    for p, (x, z) in zip(sp.bezier_points, pts): p.co = (x, 0, z); p.handle_left_type = p.handle_right_type = 'AUTO'
    o = bpy.data.objects.new(name, cv); o.location = (0, y, 0); o.data.materials.append(mat); s.collection.objects.link(o); put(o, col)
    if parent: o.parent = parent
    if col == 'train':   # to a mesh so it can carry the outline shell
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.convert(target='MESH'); bpy.ops.object.shade_smooth(); outline(o)
    return o
def drive(o, path, index, expr):
    fc = o.driver_add(path, index); fc.driver.type = 'SCRIPTED'; fc.driver.expression = expr; return fc

def fcurve(o, path, index):
    act = o.animation_data.action
    try:
        fc = act.fcurves.find(path, index=index)
        if fc: return fc
    except Exception: pass
    for layer in act.layers:
        for strip in layer.strips:
            cb = strip.channelbag(o.animation_data.action_slot)
            if cb:
                fc = cb.fcurves.find(path, index=index)
                if fc: return fc
    raise RuntimeError('no fcurve ' + path)
def key_cycle(o, path, index, keys, frame0, period, conv=lambda v: v):
    """keys: [(u, value)] over one cycle u in [0,1); keyed once, repeated with a Cycles modifier; smooth (Bezier)"""
    for u, v in list(keys) + [(1.0, keys[0][1])]:
        getattr(o, path)[index] = conv(v)
        o.keyframe_insert(path, index=index, frame=frame0 + u * period)
    fc = fcurve(o, path, index)
    for kp in fc.keyframe_points: kp.interpolation = 'BEZIER'; kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
    fc.modifiers.new('CYCLES')
    return fc
FWD = lambda deg: -math.radians(deg)   # rotation about y: a hanging segment swings toward +x (forward) for negative angles

if BG:
    # ---------- sky ----------
    def star_cross(name, size, loc, mat=STAR):
        g = empty(name, loc, col='sky')
        prim('cube', 'a', (0, 0, 0), (size, 0.01, size * 0.16), parent=g, mat=mat, col='sky', smooth=False, size=1)
        prim('cube', 'b', (0, 0, 0), (size * 0.16, 0.01, size), parent=g, mat=mat, col='sky', smooth=False, size=1)
        return g
    MOON = (7.4, 10, 2.4); MOON_R = 1.8
    for i in range(240):
        x = random.uniform(-UNIT_W / 2, UNIT_W / 2); z = random.uniform(-UNIT_H / 2 + 1.2, UNIT_H / 2)
        if (x - MOON[0]) ** 2 + (z - MOON[2]) ** 2 < (MOON_R + 1.2) ** 2: continue
        cycles = random.choice([2, 3, 4, 5, 6]); phase = random.uniform(0, TAU)
        if random.random() < 0.18:      # a four-point twinkle that breathes
            g = star_cross('twinkle%d' % i, random.uniform(0.09, 0.16), (x, 14, z))
            for ax in (0, 2): drive(g, 'scale', ax, '0.75 + 0.35*sin(frame*%.6f + %.3f)' % (TAU * cycles / FRAMES, phase))
        else:
            m = emissive('star%d' % i, (0.85, 0.9, 1.0), 3)
            sphere('star%d' % i, random.choice([0.02, 0.026, 0.034]), (x, 14, z), mat=m, col='sky')
            drive(m.node_tree.nodes['Emission'].inputs['Strength'], 'default_value', -1, '2.2 + 1.5*sin(frame*%.6f + %.3f)' % (TAU * cycles / FRAMES, phase))

    # moon: cream disc, three soft craters, a halo
    moon_mat = emissive('moon', (1.0, 0.95, 0.76), 1.25)
    prim('circle', 'moon', MOON, (MOON_R, MOON_R, 1), (math.radians(90), 0, 0), mat=moon_mat, col='sky', smooth=False, vertices=96, fill_type='NGON')
    crater = emissive('crater', (0.93, 0.86, 0.66), 1.15)
    for (cx, cz, cr) in [(-0.5, 0.45, 0.42), (0.55, -0.2, 0.3), (-0.15, -0.75, 0.24), (0.7, 0.75, 0.16)]:
        prim('circle', 'crater', (MOON[0] + cx, MOON[1] - 0.5, MOON[2] + cz), (cr, cr, 1), (math.radians(90), 0, 0), mat=crater, col='sky', smooth=False, vertices=48, fill_type='NGON')
    prim('plane', 'halo', (MOON[0], MOON[1] + 1, MOON[2]), (MOON_R * 2.7, MOON_R * 2.7, 1), (math.radians(90), 0, 0), mat=halo_mat('halo', (0.7, 0.78, 1.0), 0.32), col='sky', smooth=False, size=2)

    # ---------- ground: a snowy hill with pines along the bottom ----------
    hill = [(-UNIT_W / 2 - 1, -UNIT_H / 2 - 1), (UNIT_W / 2 + 1, -UNIT_H / 2 - 1)]
    for i in range(41):
        x = UNIT_W / 2 + 1 - i * (UNIT_W + 2) / 40
        hill.append((x, -UNIT_H / 2 + 0.55 + 0.45 * math.sin(x * 0.55 + 1.0) + 0.25 * math.sin(x * 1.7)))
    profile('hill', hill, 0.2, SNOW, col='ground', y=6)
    def pine(x, z, h, y=4):
        g = empty('pine', (x, y, z), col='ground')
        cyl('trunk', 0.06 * h, 0.35 * h, (0, 0, 0.1 * h), (0, 0, 0), g, mat=DARK, col='ground')
        for k, (zz, r, hh) in enumerate([(0.32, 0.42, 0.55), (0.62, 0.34, 0.5), (0.9, 0.24, 0.45)]):
            cone('tier', r * h, hh * h, (0, 0, zz * h), parent=g, mat=GREEN if k % 2 == 0 else GREEN_DARK, col='ground')
            cone('snowcap', r * h * 0.62, hh * h * 0.35, (0, -0.02, (zz + hh * 0.36) * h), parent=g, mat=SNOW, col='ground')
        return g
    for (x, h) in [(-11.5, 1.6), (-9.2, 1.1), (-6.8, 1.9), (-3.9, 1.3), (-1.4, 1.0), (2.6, 1.5), (5.2, 1.0), (9.0, 1.7), (11.8, 1.2)]:
        pine(x, -UNIT_H / 2 + 0.35 + 0.3 * math.sin(x * 0.55 + 1.0), h, y=4 + random.uniform(0, 1))

    # ---------- snow: light, drifting, periodic ----------
    for i in range(110):
        x0 = random.uniform(-UNIT_W / 2, UNIT_W / 2); z0 = random.uniform(0, UNIT_H + 1)
        r = random.choice([0.03, 0.04, 0.05]); wraps = random.choice([1, 2]); v = wraps * (UNIT_H + 1) / FRAMES
        f = sphere('flake%d' % i, r, (x0, 9, 0), mat=FLAKE, col='fx')
        drive(f, 'location', 2, '(%.4f - frame*%.6f) - floor((%.4f - frame*%.6f)/%.2f)*%.2f - %.2f' % (z0, v, z0, v, UNIT_H + 1, UNIT_H + 1, UNIT_H / 2 + 0.5))
        drive(f, 'location', 0, '%.4f + 0.35*sin(frame*%.6f + %.3f)' % (x0, TAU * random.choice([2, 3, 4]) / FRAMES, random.uniform(0, TAU)))

if TRAIN:
    # ---------- the train ----------
    flight = empty('flight')
    SC = 1.3
    GALLOP = 18                       # frames per stride (whole cycles over the loop: 600/16 is not whole, but the train is off-screen at the wrap)
    # Gait: a transverse gallop (right lead), one stride = GALLOP frames. u=0 is left-hind touchdown; footfalls LH 0.00,
    # RH 0.12, LF 0.45, RF 0.57; stance is about 0.3 of the cycle, then the leg folds and swings forward and extends
    # before touchdown; suspension (all four gathered, body highest) around u=0.8. Angles in degrees, forward positive,
    # each joint relative to the segment above it. Hind leg: hip -> stifle (the lower leg folds *back*) -> hock (the
    # cannon folds *forward*: the reversed-knee look) -> fetlock. Fore leg: shoulder -> elbow (forearm folds forward)
    # -> carpus (cannon tucks *back*, hoof up behind) -> fetlock.
    FOOTFALL = {'LH': 0.0, 'RH': 0.12, 'LF': 0.45, 'RF': 0.57}
    HIND = {
        'hip':     [(0, 32), (0.15, 12), (0.3, -22), (0.5, -18), (0.7, 12), (0.85, 40)],
        'stifle':  [(0, -38), (0.15, -42), (0.3, -48), (0.5, -85), (0.7, -95), (0.85, -60)],
        'hock':    [(0, 18), (0.15, 14), (0.3, 34), (0.5, 82), (0.7, 88), (0.85, 48)],
        'fetlock': [(0, 6), (0.15, 0), (0.3, -16), (0.5, 22), (0.7, 26), (0.85, 12)],
    }
    FORE = {
        'shoulder': [(0, -8), (0.15, -24), (0.3, -46), (0.5, -42), (0.7, -16), (0.85, 6)],
        'elbow':    [(0, 44), (0.15, 30), (0.3, 18), (0.5, 58), (0.7, 82), (0.85, 62)],
        'carpus':   [(0, -6), (0.15, 0), (0.3, 6), (0.5, -92), (0.7, -104), (0.85, -42)],
        'fetlock':  [(0, 10), (0.15, 0), (0.3, -12), (0.5, 30), (0.7, 26), (0.85, 16)],
    }
    BODY_BOB = [(0, -0.02), (0.15, -0.045), (0.3, -0.01), (0.5, -0.02), (0.7, 0.045), (0.85, 0.06)]
    BODY_PITCH = [(0, 3), (0.15, 4.5), (0.3, 1), (0.5, -3), (0.7, -4.5), (0.85, -1)]
    HEAD_NOD = [(0, -4), (0.15, -6), (0.3, 0), (0.5, 5), (0.7, 7), (0.85, 2)]

    def joint(name, parent, at, keys, frame0, period):
        j = empty(name, at, parent)
        key_cycle(j, 'rotation_euler', 1, keys, frame0, period, FWD)
        return j
    def segment(name, parent, length, r0, r1, mat, ball=True):
        if ball: sphere(name + '_ball', r0 * 1.02, (0, 0, 0), parent=parent, mat=mat)
        cyl(name, r0, length, (0, 0, -length / 2), (0, 0, 0), parent, mat, r2=r1)
    def hoof(parent):
        sphere('hoof', 0.062, (0.015, 0, -0.03), (1.15, 0.85, 0.62), parent, DARK)

    def hind_leg(body, at, frame0, period, far=False):
        up, lo = (BROWN_DARK, BROWN) if far else (BROWN, BROWN_LIGHT)
        hip = joint('hip', body, at, HIND['hip'], frame0, period)
        segment('thigh', hip, 0.36, 0.105, 0.07, up)
        stifle = joint('stifle', hip, (0, 0, -0.36), HIND['stifle'], frame0, period)
        segment('gaskin', stifle, 0.34, 0.07, 0.05, up)
        hock = joint('hock', stifle, (0, 0, -0.34), HIND['hock'], frame0, period)
        segment('cannon', hock, 0.32, 0.05, 0.042, lo)
        fet = joint('fetlock', hock, (0, 0, -0.32), HIND['fetlock'], frame0, period)
        sphere('fet_ball', 0.045, (0, 0, 0), parent=fet, mat=lo); hoof(fet)
    def fore_leg(body, at, frame0, period, far=False):
        up, lo = (BROWN_DARK, BROWN) if far else (BROWN, BROWN_LIGHT)
        sh = joint('shoulder', body, at, FORE['shoulder'], frame0, period)
        segment('upperarm', sh, 0.3, 0.095, 0.065, up)
        el = joint('elbow', sh, (0, 0, -0.3), FORE['elbow'], frame0, period)
        segment('forearm', el, 0.34, 0.065, 0.048, up)
        ca = joint('carpus', el, (0, 0, -0.34), FORE['carpus'], frame0, period)
        segment('cannon', ca, 0.3, 0.048, 0.04, lo)
        fet = joint('fetlock', ca, (0, 0, -0.3), FORE['fetlock'], frame0, period)
        sphere('fet_ball', 0.042, (0, 0, 0), parent=fet, mat=lo); hoof(fet)

    def reindeer(name, x, phase0, lead=False):
        d = empty(name, (x, 0, 0), flight); d.scale = (SC, SC, SC)
        f0 = phase0 * GALLOP
        body = empty('bodyrig', (0, 0, 0), d)
        key_cycle(body, 'location', 2, BODY_BOB, f0, GALLOP)
        key_cycle(body, 'rotation_euler', 1, BODY_PITCH, f0, GALLOP, FWD)
        sphere('body', 0.42, (0, 0, 0), (1.45, 0.6, 0.68), body, BROWN)
        sphere('chest', 0.3, (0.5, 0, 0.0), (0.9, 0.85, 0.95), body, BROWN)
        sphere('haunch', 0.3, (-0.42, 0, -0.02), (0.85, 0.8, 1.0), body, BROWN)
        cyl('neck', 0.16, 0.62, (0.62, 0, 0.36), (0, math.radians(-42), 0), body, BROWN, r2=0.13)
        head = empty('head', (0.86, 0, 0.66), body)
        key_cycle(head, 'rotation_euler', 1, HEAD_NOD, f0, GALLOP, FWD)
        sphere('skull', 0.22, (0, 0, 0), (1.15, 0.8, 0.9), head, BROWN)
        sphere('muzzle', 0.14, (0.24, 0, -0.07), (1.35, 0.85, 0.8), head, BROWN_LIGHT)
        sphere('nose', 0.08, (0.43, 0, -0.04), parent=head, mat=NOSE if lead else DARK)
        if lead:
            prim('plane', 'noseglow', (0.43, -0.35, -0.04), (0.42, 0.42, 1), (math.radians(90), 0, 0), mat=halo_mat('noseglow', (1.0, 0.2, 0.1), 0.9, 2.0), parent=head, col='fx', smooth=False, size=2)
        for sy in (-1, 1):
            sphere('eye', 0.055, (0.14, sy * 0.14, 0.09), parent=head, mat=EYE_WHITE)
            sphere('pupil', 0.028, (0.18, sy * 0.155, 0.095), parent=head, mat=DARK)
            cyl('ear', 0.04, 0.2, (-0.06, sy * 0.16, 0.22), (math.radians(45 * sy), math.radians(-15), 0), head, BROWN_LIGHT, r2=0.02)
            a = empty('antler', (-0.05, sy * 0.09, 0.24), head)
            cyl('beam', 0.032, 0.5, (0, 0, 0.25), (math.radians(14 * sy), math.radians(-20), 0), a, TAN, r2=0.02)
            cyl('tine1', 0.024, 0.26, (-0.1, 0, 0.32), (math.radians(20 * sy), math.radians(-70), 0), a, TAN, r2=0.012)
            cyl('tine2', 0.024, 0.22, (0.08, 0, 0.42), (math.radians(20 * sy), math.radians(40), 0), a, TAN, r2=0.012)
            cyl('tine3', 0.02, 0.18, (-0.02, 0, 0.5), (math.radians(20 * sy), math.radians(-25), 0), a, TAN, r2=0.01)
        cyl('tail', 0.05, 0.16, (-0.72, 0, 0.16), (0, math.radians(-40), 0), body, BROWN_LIGHT, r2=0.02)
        torus('collar', 0.34, 0.045, (0.5, 0, 0.12), (0, math.radians(-40), 0), body, RED_DARK, scale=(1, 1, 1.05))
        sphere('bell', 0.06, (0.6, 0, -0.2), parent=body, mat=GOLD)
        torus('girth', 0.41, 0.03, (-0.05, 0, -0.02), (0, math.radians(90), 0), body, GOLD, scale=(1.0, 0.9, 1))
        # legs: the near pair toward the camera (-y), the far pair a little inboard and behind
        hind_leg(body, (-0.40, -0.13, -0.16), f0 + FOOTFALL['LH'] * GALLOP, GALLOP)
        hind_leg(body, (-0.44, 0.13, -0.16), f0 + FOOTFALL['RH'] * GALLOP, GALLOP, far=True)
        fore_leg(body, (0.44, -0.13, -0.08), f0 + FOOTFALL['LF'] * GALLOP, GALLOP)
        fore_leg(body, (0.40, 0.13, -0.08), f0 + FOOTFALL['RF'] * GALLOP, GALLOP, far=True)
        return d

    def santa(parent):
        g = empty('santa', (-0.22, 0, 0.44), parent)
        sphere('coat', 0.3, (0, 0, 0), (1.0, 0.9, 1.05), g, RED)
        torus('belt', 0.29, 0.035, (0, 0, -0.04), (0, 0, 0), g, DARK, scale=(1, 0.9, 1))
        prim('cube', 'buckle', (0.27, 0, -0.04), (0.04, 0.06, 0.05), parent=g, mat=GOLD, smooth=False, size=1)
        torus('hem', 0.3, 0.04, (0, 0, -0.26), (0, 0, 0), g, WHITE, scale=(1, 0.9, 1))
        sphere('head', 0.16, (0.02, 0, 0.36), parent=g, mat=SKIN)
        sphere('beard', 0.16, (0.1, 0, 0.26), (1.0, 0.85, 0.9), g, WHITE)
        sphere('moustache', 0.07, (0.17, 0, 0.32), (1.2, 0.8, 0.5), g, WHITE)
        sphere('nose', 0.04, (0.19, 0, 0.36), parent=g, mat=SKIN)
        for sy in (-1, 1):
            sphere('eye', 0.022, (0.14, sy * 0.06, 0.4), parent=g, mat=DARK)
        torus('hatband', 0.15, 0.045, (0, 0, 0.47), (0, 0, 0), g, WHITE)
        cone('hat', 0.15, 0.42, (-0.05, 0, 0.66), (0, math.radians(-38), 0), g, RED)
        sphere('pom', 0.06, (-0.24, 0, 0.8), parent=g, mat=WHITE)
        # arms: left holds the reins, right waves
        la = empty('larm', (0.2, -0.1, 0.1), g); la.rotation_euler = (0, math.radians(-40), 0)
        cyl('sleeve', 0.065, 0.32, (0, 0, 0.16), (0, 0, 0), la, RED); sphere('mitt', 0.07, (0, 0, 0.36), parent=la, mat=WHITE)
        ra = empty('rarm', (-0.05, 0.14, 0.18), g)
        drive(ra, 'rotation_euler', 1, '-2.3 + 0.55*sin(frame*0.42)')
        drive(ra, 'rotation_euler', 0, '0.25*sin(frame*0.42 + 1.0)')
        cyl('sleeve', 0.065, 0.36, (0, 0, 0.18), (0, 0, 0), ra, RED); torus('cuff', 0.07, 0.025, (0, 0, 0.33), (0, 0, 0), ra, WHITE)
        sphere('mitt', 0.075, (0, 0, 0.42), parent=ra, mat=WHITE)
        return g

    def sleigh():
        g = empty('sleigh', (0, 0, -0.02), flight); g.scale = (SC, SC, SC)
        rig = empty('rig', (0, 0, 0), g)       # follow-through: a lagged bob and a little pitch
        drive(rig, 'location', 2, '0.06*sin(frame*%.5f - 1.1)' % (TAU / GALLOP))
        drive(rig, 'rotation_euler', 1, '0.04*sin(frame*%.5f - 2.0)' % (TAU / GALLOP))
        # body: side profile with a curled prow and a tall back, extruded; gold trim along the top
        body_pts = [(-1.0, -0.3), (0.95, -0.3), (1.15, -0.1), (1.3, 0.25), (1.28, 0.55), (1.12, 0.62), (1.02, 0.5), (1.08, 0.36), (0.98, 0.2),
                    (0.55, 0.12), (-0.3, 0.12), (-0.62, 0.15), (-0.9, 0.45), (-1.02, 0.66), (-1.12, 0.6), (-1.1, 0.2)]
        sbody = profile('body', body_pts, 0.6, RED, rig)
        profile('bodyside', [(x * 1.01, z) for x, z in body_pts], 0.64, RED_DARK, rig, y=0)   # a darker skin so the outline reads
        curve('trim', [(-1.12, 0.6), (-1.02, 0.66), (-0.9, 0.45), (-0.62, 0.15), (-0.3, 0.12), (0.55, 0.12), (0.98, 0.2), (1.08, 0.36), (1.02, 0.5), (1.12, 0.62), (1.28, 0.55), (1.3, 0.25)], 0.028, GOLD, rig, y=-0.31)
        curve('trim2', [(-1.12, 0.6), (-1.02, 0.66), (-0.9, 0.45), (-0.62, 0.15), (-0.3, 0.12), (0.55, 0.12), (0.98, 0.2), (1.08, 0.36), (1.02, 0.5), (1.12, 0.62), (1.28, 0.55), (1.3, 0.25)], 0.028, GOLD, rig, y=0.31)
        prim('cube', 'seat', (-0.45, 0, 0.2), (0.28, 0.28, 0.06), parent=rig, mat=RED_DARK, smooth=False, size=1)
        for sy in (-1, 1):
            curve('runner', [(-1.25, -0.62), (-0.6, -0.68), (0.5, -0.68), (1.15, -0.62), (1.55, -0.3), (1.6, 0.05), (1.45, 0.2)], 0.045, GOLD, rig, y=sy * 0.28)
            for x in (-0.75, 0.55): cyl('strut', 0.035, 0.36, (x, sy * 0.28, -0.48), (0, 0, 0), rig, GOLD)
        # lantern on the prow
        cyl('post', 0.025, 0.3, (1.22, 0, 0.75), (0, 0, 0), rig, DARK)
        sphere('lantern', 0.09, (1.22, 0, 0.95), parent=rig, mat=LANTERN)
        prim('plane', 'lanternglow', (1.22, -0.3, 0.95), (0.6, 0.6, 1), (math.radians(90), 0, 0), mat=halo_mat('lanternglow', (1.0, 0.7, 0.3), 0.8, 2.0), parent=rig, col='fx', smooth=False, size=2)
        santa(rig)
        # the sack: a tied bundle with two gifts poking out
        sphere('sack', 0.32, (-0.72, 0, 0.5), (0.9, 0.85, 1.05), rig, BROWN_LIGHT)
        sphere('sacktop', 0.14, (-0.78, 0, 0.84), (1, 1, 0.7), rig, BROWN_LIGHT); torus('tie', 0.12, 0.025, (-0.78, 0, 0.78), (0, 0, 0), rig, RED)
        prim('cube', 'gift1', (-0.6, -0.12, 0.72), (0.1, 0.1, 0.1), (0, 0, math.radians(20)), parent=rig, mat=GREEN, smooth=False, size=1)
        prim('cube', 'gift2', (-0.85, 0.1, 0.7), (0.08, 0.08, 0.08), (math.radians(15), 0, 0), parent=rig, mat=GOLD, smooth=False, size=1)
        return g, rig, sbody

    DEER_X = [7.6, 5.2, 2.8]
    deers = [reindeer('deer%d' % i, x, 0.18 * i, lead=(i == 0)) for i, x in enumerate(DEER_X)]
    sl, rig, body = sleigh()
    # reins: from Santa's left mitt to each collar, drooping a little
    for x in DEER_X:
        curve('rein', [(-0.02 * SC, 0.62 * SC), (x * 0.5, 0.3 * SC), (x + 0.45 * SC, 0.1 * SC)], 0.014, DARK, flight, y=-0.12 * SC)

    # flight path: off-screen left → off-screen right over frames 20..470, drifting a little downward, gentle swoop
    X_IN, X_OUT = -UNIT_W / 2 - 11.5, UNIT_W / 2 + 5.0
    F_IN, F_OUT = (8, 452) if SCENE == 'sleigh' else (20, 470)
    for f in range(1, FRAMES + 1):
        u = min(1, max(0, (f - F_IN) / (F_OUT - F_IN)))
        x = X_IN + (X_OUT - X_IN) * u
        z = 2.55 + 0.45 * math.sin(TAU * f / 90) - 0.7 * u
        flight.location = (x, 0, z); flight.keyframe_insert('location', frame=f)
        flight.rotation_euler = (0, math.radians(-8 + 3.5 * math.sin(TAU * f / 90 + 1.2)), 0); flight.keyframe_insert('rotation_euler', frame=f)

    # sparkle trail: spinning four-point stars from the sleigh body
    me = bpy.data.meshes.new('spark'); a, b = 0.1, 0.018
    me.from_pydata([(-a, 0, -b), (a, 0, -b), (a, 0, b), (-a, 0, b), (-b, 0, -a), (b, 0, -a), (b, 0, a), (-b, 0, a)], [], [[0, 1, 2, 3], [4, 5, 6, 7]]); me.update()
    spark = bpy.data.objects.new('spark', me); spark.location = (0, -30, -30); spark.data.materials.append(SPARK); s.collection.objects.link(spark); put(spark, 'fx')
    body.modifiers.new('sparks', 'PARTICLE_SYSTEM')
    ps = body.particle_systems[0].settings
    ps.count = 1100; ps.frame_start = F_IN; ps.frame_end = F_OUT; ps.lifetime = 42; ps.lifetime_random = 0.5
    ps.emit_from = 'VOLUME'; ps.render_type = 'OBJECT'; ps.instance_object = spark
    ps.particle_size = 1.0; ps.size_random = 0.6; ps.use_scale_instance = True
    ps.normal_factor = 0.0; ps.object_factor = -0.1; ps.factor_random = 0.7
    ps.effector_weights.gravity = 0.04
    ps.use_rotations = True; ps.rotation_mode = 'NOR'; ps.phase_factor_random = 2.0; ps.angular_velocity_mode = 'RAND'; ps.angular_velocity_factor = 6.0

# ---------- (Freestyle kept configured but off; see outline()) ----------
s.render.use_freestyle = False   # outlines are inverted-hull shells (outline()); Freestyle was too slow and hungry on these meshes
vl = s.view_layers[0]; vl.use_freestyle = True
fs = vl.freestyle_settings; fs.crease_angle = math.radians(140)
ls = fs.linesets.new('ink'); ls.select_by_collection = True; ls.collection = COL['train']   # (unused when TRAIN is off)
ls.select_silhouette = True; ls.select_border = True; ls.select_crease = False; ls.select_contour = True
ls.linestyle.color = (0.10, 0.04, 0.03); ls.linestyle.thickness = 2.4

# ---------- render ----------
frames = ([300] if TRAIN else [1, 300]) if PREVIEW else list(range(1, FRAMES + 1))
if PREVIEW:
    for f in frames:
        s.frame_set(f); s.render.filepath = '%s/frame_%04d' % (OUT.rstrip('/'), f)
        bpy.ops.render.render(write_still=True)
else:
    bpy.ops.render.render(animation=True)
print('DONE', len(frames), 'frames ->', OUT)
