-- stickyflow for LuaLaTeX: renders SFL with the core of stickyflow.js, translated to Lua, and draws the SVG it gives as PDF, with the texts set
-- by TeX in the fonts of the document.

local stickyflow = {}

---------------------------------------------------------------------------------------------------------------------------------------------
-- What the core needs of JavaScript, beyond what the translator brings.

local plain = tostring

-- Numbers as JavaScript writes them: whole numbers without a point, others in the shortest form that reads back as the same number.
local function jsNumber(v)
  if v ~= v then return 'NaN' end
  if v == math.huge then return 'Infinity' end
  if v == -math.huge then return '-Infinity' end
  if v == math.floor(v) and v > -1e21 and v < 1e21 then return string.format('%d', v) end
  local s
  for p = 1, 17 do
    s = string.format('%.' .. p .. 'g', v)
    if tonumber(s) == v then break end
  end
  local mantissa, exponent = s:match('^(.-)e([-+]%d+)$')
  if exponent then
    local e = tonumber(exponent)
    if e >= -7 and e < 21 then
      s = string.format('%.' .. math.max(0, -e + #mantissa:gsub('[^%d]', '') - 1) .. 'f', v)
      s = s:gsub('(%..-)0+$', '%1'):gsub('%.$', '')
    else
      s = mantissa .. 'e' .. (e > 0 and '+' or '-') .. math.abs(e)
    end
  end
  return s
end

tostring = function(v)
  if math.type(v) == 'float' then return jsNumber(v) end
  return plain(v)
end

-- The globals of JavaScript that the core passes around as functions, as in list.filter(Boolean).
Boolean = function(_, v) return not (v == nil or v == false or v == 0 or v == '' or v ~= v) end
Number = function(_, v)
  if type(v) == 'number' then return v end
  if v == nil then return 0 / 0 end
  if v == true then return 1 end
  if v == false then return 0 end
  local s = plain(v):match('^%s*(.-)%s*$')
  if s == '' then return 0 end
  return tonumber(s) or 0 / 0
end
String = function(_, v) return tostring(v) end

-- The arguments as a list, without the ones that are undefined: Lua cannot keep a list with holes.
function __compact(...)
  local out = {}
  for i = 1, select('#', ...) do
    local v = select(i, ...)
    if v ~= nil then out[#out + 1] = v end
  end
  return out
end

-- An object with getters, as JavaScript has them in an object literal.
function __getters(object, getters)
  return setmetatable(object, { __index = function(_, key)
    local getter = getters[key]
    if getter then return getter(nil) end
  end })
end

-- A deep copy of plain data; tables keep their metatable, so the maps and sets of the core stay what they are.
function __deepClone(value, seen)
  if type(value) ~= 'table' then return value end
  seen = seen or {}
  if seen[value] then return seen[value] end
  local copy = {}
  seen[value] = copy
  for k, v in pairs(value) do copy[__deepClone(k, seen)] = __deepClone(v, seen) end
  return setmetatable(copy, getmetatable(value))
end

local core = require('stickyflow-core')

function stickyflow.render(source, data)
  return core.renderSfl(nil, source, data)
end

---------------------------------------------------------------------------------------------------------------------------------------------
-- The SVG, read into a tree. The renderer writes well-formed SVG of a known shape, so a small reader is enough.

local entities = { amp = '&', lt = '<', gt = '>', quot = '"', apos = "'" }

local function unescape(s)
  return (s:gsub('&(#?x?)(%w+);', function(kind, body)
    if kind == '#' then return utf8.char(tonumber(body)) end
    if kind == '#x' then return utf8.char(tonumber(body, 16)) end
    return entities[body] or ('&' .. body .. ';')
  end))
end

local function parseSvg(svg)
  local root = { name = '#root', attrs = {}, children = {} }
  local stack = { root }
  local pos = 1
  while true do
    local start, finish, close, name, rest, selfClose = svg:find('<(/?)([%w:_-]+)(.-)(/?)>', pos)
    if not start then break end
    local text = svg:sub(pos, start - 1)
    if text:find('%S') then
      local parent = stack[#stack]
      parent.children[#parent.children + 1] = { name = '#text', text = unescape(text) }
    end
    if name:sub(1, 1) ~= '?' and name:sub(1, 1) ~= '!' then
      if close == '/' then
        stack[#stack] = nil
      else
        local node = { name = name, attrs = {}, children = {} }
        for key, value in rest:gmatch('([%w:_-]+)="([^"]*)"') do
          node.attrs[key] = unescape(value)
        end
        local parent = stack[#stack]
        parent.children[#parent.children + 1] = node
        if selfClose ~= '/' then stack[#stack + 1] = node end
      end
    end
    pos = finish + 1
  end
  for _, node in ipairs(root.children) do
    if node.name == 'svg' then return node end
  end
  error('stickyflow: the renderer gave no <svg>')
end

---------------------------------------------------------------------------------------------------------------------------------------------
-- Colors. A color with transparency is mixed with white, which is the paper of a figure in almost every case.

local function hex(s)
  if #s == 3 then s = s:gsub('.', '%0%0') end
  return tonumber(s:sub(1, 2), 16) / 255, tonumber(s:sub(3, 4), 16) / 255, tonumber(s:sub(5, 6), 16) / 255
end

local named = { white = { 1, 1, 1 }, black = { 0, 0, 0 }, red = { 1, 0, 0 }, green = { 0, 0.5, 0 }, blue = { 0, 0, 1 }, gray = { 0.5, 0.5, 0.5 } }

-- Red, green, blue and alpha, each from 0 to 1, or nil for no paint.
local function color(value, gradients)
  if not value or value == 'none' or value == 'transparent' then return nil end
  local id = value:match('^url%(#(.-)%)$')
  if id then
    local stops = gradients[id]
    if not stops or #stops == 0 then return nil end
    -- A gradient is drawn as its middle color for now.
    local a, b = stops[1], stops[#stops]
    return (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, (a[3] + b[3]) / 2, (a[4] + b[4]) / 2
  end
  local h = value:match('^#(%x+)$')
  if h then
    if #h == 8 then
      local r, g, b = hex(h:sub(1, 6))
      return r, g, b, tonumber(h:sub(7, 8), 16) / 255
    end
    local r, g, b = hex(h:sub(1, 6))
    return r, g, b, 1
  end
  local inner = value:match('^rgba?%((.-)%)$')
  if inner then
    local parts = {}
    for part in inner:gmatch('[^,%s]+') do parts[#parts + 1] = part end
    local function channel(p) return p:find('%%') and tonumber(p:sub(1, -2)) / 100 or tonumber(p) / 255 end
    return channel(parts[1]), channel(parts[2]), channel(parts[3]), tonumber(parts[4] or '1')
  end
  local n = named[value]
  if n then return n[1], n[2], n[3], 1 end
  return 0, 0, 0, 1
end

local function onWhite(r, g, b, a, opacity)
  local alpha = a * opacity
  return 1 - alpha + alpha * r, 1 - alpha + alpha * g, 1 - alpha + alpha * b, alpha
end

---------------------------------------------------------------------------------------------------------------------------------------------
-- Paths, as PDF operators in the coordinates of the SVG. The figure as a whole is turned into PDF coordinates by one transform.

local function f(n)
  return string.format('%.4f', n):gsub('%.?0+$', '')
end

local function numbers(s)
  local out = {}
  local pos = 1
  while true do
    local a, b = s:find('[-+]?%d*%.?%d+', pos)
    if not a then break end
    local e1, e2 = s:find('^[eE][-+]?%d+', b + 1)
    if e1 then b = e2 end
    out[#out + 1] = tonumber(s:sub(a, b))
    pos = b + 1
  end
  return out
end

-- An elliptical arc of the SVG as cubic curves, after the implementation notes of the SVG specification.
local function arcToCurves(ops, x1, y1, rx, ry, angle, large, sweep, x2, y2)
  if rx == 0 or ry == 0 then
    ops[#ops + 1] = f(x2) .. ' ' .. f(y2) .. ' l'
    return
  end
  rx, ry = math.abs(rx), math.abs(ry)
  local phi = math.rad(angle)
  local cos, sin = math.cos(phi), math.sin(phi)
  local dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
  local x1p, y1p = cos * dx + sin * dy, -sin * dx + cos * dy
  local lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if lambda > 1 then
    local s = math.sqrt(lambda)
    rx, ry = rx * s, ry * s
  end
  local num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  local den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  local coef = math.sqrt(math.max(0, num / den))
  if large == sweep then coef = -coef end
  local cxp, cyp = coef * rx * y1p / ry, -coef * ry * x1p / rx
  local cx, cy = cos * cxp - sin * cyp + (x1 + x2) / 2, sin * cxp + cos * cyp + (y1 + y2) / 2
  local function vecAngle(ux, uy, vx, vy)
    local a = math.atan(uy, ux)
    local b = math.atan(vy, vx)
    return b - a
  end
  local theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  local delta = vecAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  delta = delta % (2 * math.pi)
  if sweep == 0 and delta > 0 then delta = delta - 2 * math.pi end
  if sweep == 1 and delta < 0 then delta = delta + 2 * math.pi end
  local segments = math.max(1, math.ceil(math.abs(delta) / (math.pi / 2) - 1e-9))
  local step = delta / segments
  local k = 4 / 3 * math.tan(step / 4)
  local function point(t)
    local ct, st = math.cos(t), math.sin(t)
    return cx + rx * ct * cos - ry * st * sin, cy + rx * ct * sin + ry * st * cos, -rx * st * cos - ry * ct * sin, -rx * st * sin + ry * ct * cos
  end
  local t = theta1
  for _ = 1, segments do
    local ax, ay, adx, ady = point(t)
    local bx, by, bdx, bdy = point(t + step)
    ops[#ops + 1] = string.format('%s %s %s %s %s %s c', f(ax + k * adx), f(ay + k * ady), f(bx - k * bdx), f(by - k * bdy), f(bx), f(by))
    t = t + step
  end
end

-- The path of an SVG d attribute as PDF operators, with the points where it starts and ends and the directions there, for markers.
local function pathOps(d)
  local ops = {}
  local x, y, sx, sy = 0, 0, 0, 0
  local first, last
  local function mark(px, py, dx, dy)
    if not first then first = { px, py, dx, dy } end
    last = { px, py, dx, dy }
  end
  for command, args in d:gmatch('([MLHVCQAZmlhvcqaz])([^MLHVCQAZmlhvcqaz]*)') do
    local n = numbers(args)
    local up = command:upper()
    local rel = command ~= up
    local i = 1
    repeat
      if up == 'M' then
        local nx, ny = n[i] + (rel and x or 0), n[i + 1] + (rel and y or 0)
        ops[#ops + 1] = f(nx) .. ' ' .. f(ny) .. ' m'
        x, y, sx, sy = nx, ny, nx, ny
        i = i + 2
        up = 'L'
      elseif up == 'L' then
        local nx, ny = n[i] + (rel and x or 0), n[i + 1] + (rel and y or 0)
        ops[#ops + 1] = f(nx) .. ' ' .. f(ny) .. ' l'
        mark(x, y, nx - x, ny - y)
        mark(nx, ny, nx - x, ny - y)
        x, y = nx, ny
        i = i + 2
      elseif up == 'H' then
        local nx = n[i] + (rel and x or 0)
        ops[#ops + 1] = f(nx) .. ' ' .. f(y) .. ' l'
        mark(x, y, nx - x, 0)
        mark(nx, y, nx - x, 0)
        x = nx
        i = i + 1
      elseif up == 'V' then
        local ny = n[i] + (rel and y or 0)
        ops[#ops + 1] = f(x) .. ' ' .. f(ny) .. ' l'
        mark(x, y, 0, ny - y)
        mark(x, ny, 0, ny - y)
        y = ny
        i = i + 1
      elseif up == 'C' then
        local o = rel and { x, y } or { 0, 0 }
        local c1x, c1y, c2x, c2y = n[i] + o[1], n[i + 1] + o[2], n[i + 2] + o[1], n[i + 3] + o[2]
        local nx, ny = n[i + 4] + o[1], n[i + 5] + o[2]
        ops[#ops + 1] = string.format('%s %s %s %s %s %s c', f(c1x), f(c1y), f(c2x), f(c2y), f(nx), f(ny))
        mark(x, y, c1x - x, c1y - y)
        mark(nx, ny, nx - c2x, ny - c2y)
        x, y = nx, ny
        i = i + 6
      elseif up == 'Q' then
        local o = rel and { x, y } or { 0, 0 }
        local qx, qy, nx, ny = n[i] + o[1], n[i + 1] + o[2], n[i + 2] + o[1], n[i + 3] + o[2]
        ops[#ops + 1] = string.format('%s %s %s %s %s %s c', f(x + 2 / 3 * (qx - x)), f(y + 2 / 3 * (qy - y)), f(nx + 2 / 3 * (qx - nx)), f(ny + 2 / 3 * (qy - ny)), f(nx), f(ny))
        mark(x, y, qx - x, qy - y)
        mark(nx, ny, nx - qx, ny - qy)
        x, y = nx, ny
        i = i + 4
      elseif up == 'A' then
        local nx, ny = n[i + 5] + (rel and x or 0), n[i + 6] + (rel and y or 0)
        arcToCurves(ops, x, y, n[i], n[i + 1], n[i + 2], n[i + 3], n[i + 4], nx, ny)
        mark(x, y, nx - x, ny - y)
        mark(nx, ny, nx - x, ny - y)
        x, y = nx, ny
        i = i + 7
      elseif up == 'Z' then
        ops[#ops + 1] = 'h'
        x, y = sx, sy
        i = i + 1
      end
    until i > #n or up == 'Z'
  end
  return table.concat(ops, ' '), first, last
end

local function rectOps(x, y, w, h, rx, ry)
  rx, ry = math.min(rx or 0, w / 2), math.min(ry or rx or 0, h / 2)
  if rx <= 0 then
    return string.format('%s %s %s %s re', f(x), f(y), f(w), f(h))
  end
  local k = 0.5523
  return table.concat({
    f(x + rx) .. ' ' .. f(y) .. ' m',
    f(x + w - rx) .. ' ' .. f(y) .. ' l',
    string.format('%s %s %s %s %s %s c', f(x + w - rx + k * rx), f(y), f(x + w), f(y + ry - k * ry), f(x + w), f(y + ry)),
    f(x + w) .. ' ' .. f(y + h - ry) .. ' l',
    string.format('%s %s %s %s %s %s c', f(x + w), f(y + h - ry + k * ry), f(x + w - rx + k * rx), f(y + h), f(x + w - rx), f(y + h)),
    f(x + rx) .. ' ' .. f(y + h) .. ' l',
    string.format('%s %s %s %s %s %s c', f(x + rx - k * rx), f(y + h), f(x), f(y + h - ry + k * ry), f(x), f(y + h - ry)),
    f(x) .. ' ' .. f(y + ry) .. ' l',
    string.format('%s %s %s %s %s %s c', f(x), f(y + ry - k * ry), f(x + rx - k * rx), f(y), f(x + rx), f(y)),
    'h',
  }, ' ')
end

local function ellipseOps(cx, cy, rx, ry)
  local k = 0.5523
  return table.concat({
    f(cx + rx) .. ' ' .. f(cy) .. ' m',
    string.format('%s %s %s %s %s %s c', f(cx + rx), f(cy + k * ry), f(cx + k * rx), f(cy + ry), f(cx), f(cy + ry)),
    string.format('%s %s %s %s %s %s c', f(cx - k * rx), f(cy + ry), f(cx - rx), f(cy + k * ry), f(cx - rx), f(cy)),
    string.format('%s %s %s %s %s %s c', f(cx - rx), f(cy - k * ry), f(cx - k * rx), f(cy - ry), f(cx), f(cy - ry)),
    string.format('%s %s %s %s %s %s c', f(cx + k * rx), f(cy - ry), f(cx + rx), f(cy - k * ry), f(cx + rx), f(cy)),
    'h',
  }, ' ')
end

local function num(attrs, key, default)
  local v = attrs[key]
  return v and tonumber((v:gsub('px$', ''))) or default
end

-- The outline of an element, as the operators that build it, or nil for an element that has none.
local function outline(node)
  local a = node.attrs
  if node.name == 'path' and a.d then
    return pathOps(a.d)
  elseif node.name == 'rect' then
    return rectOps(num(a, 'x', 0), num(a, 'y', 0), num(a, 'width', 0), num(a, 'height', 0), num(a, 'rx', 0), num(a, 'ry', nil))
  elseif node.name == 'ellipse' or node.name == 'circle' then
    local r = num(a, 'r', 0)
    return ellipseOps(num(a, 'cx', 0), num(a, 'cy', 0), num(a, 'rx', r), num(a, 'ry', r))
  end
end

local function transformOps(value)
  if not value then return '' end
  local out = {}
  for name, args in value:gmatch('(%a+)%(([^)]*)%)') do
    local n = numbers(args)
    if name == 'rotate' then
      local t = math.rad(n[1])
      local cx, cy = n[2] or 0, n[3] or 0
      local c, s = math.cos(t), math.sin(t)
      out[#out + 1] = string.format('1 0 0 1 %s %s cm %s %s %s %s 0 0 cm 1 0 0 1 %s %s cm', f(cx), f(cy), f(c), f(s), f(-s), f(c), f(-cx), f(-cy))
    elseif name == 'translate' then
      out[#out + 1] = string.format('1 0 0 1 %s %s cm', f(n[1]), f(n[2] or 0))
    elseif name == 'scale' then
      out[#out + 1] = string.format('%s 0 0 %s 0 0 cm', f(n[1]), f(n[2] or n[1]))
    elseif name == 'matrix' then
      out[#out + 1] = string.format('%s %s %s %s %s %s cm', f(n[1]), f(n[2]), f(n[3]), f(n[4]), f(n[5]), f(n[6]))
    end
  end
  return table.concat(out, ' ')
end

---------------------------------------------------------------------------------------------------------------------------------------------
-- Drawing the figure: one PDF literal for each shape, and a TeX box for each text, in the order of the SVG.

local function texEscape(s)
  return (s:gsub('[\\{}$&#^_%%~]', function(c)
    if c == '\\' then return '\\textbackslash{}' end
    if c == '^' then return '\\textasciicircum{}' end
    if c == '~' then return '\\textasciitilde{}' end
    return '\\' .. c
  end))
end

local function rgbText(r, g, b)
  return string.format('%s,%s,%s', f(r), f(g), f(b))
end

-- The graphics states with transparency, by their fill and stroke alpha, shared by all figures of the document.
local graphicsStates = { list = {} }

function stickyflow.draw(svg, width, mark)
  local root = parseSvg(svg)
  local vb = numbers(root.attrs.viewBox or ('0 0 ' .. (root.attrs.width or '100') .. ' ' .. (root.attrs.height or '100')))
  local vx, vy, vw, vh = vb[1], vb[2], vb[3], vb[4]
  local scale = (width or vw) / vw
  local height = vh * scale
  local gradients, clips, markers = {}, {}, {}
  local out = {}

  -- Definitions first: gradients, clips and markers, by their id.
  local function definitions(node)
    for _, child in ipairs(node.children or {}) do
      if child.name == 'linearGradient' or child.name == 'radialGradient' then
        local stops = {}
        for _, stop in ipairs(child.children) do
          if stop.name == 'stop' then
            local r, g, b, a = color(stop.attrs['stop-color'] or '#000000', gradients)
            stops[#stops + 1] = { r or 0, g or 0, b or 0, (a or 1) * (num(stop.attrs, 'stop-opacity', 1)) }
          end
        end
        gradients[child.attrs.id] = stops
      elseif child.name == 'clipPath' then
        local parts = {}
        for _, shape in ipairs(child.children) do
          local ops = outline(shape)
          if ops then parts[#parts + 1] = transformOps(shape.attrs.transform) == '' and ops or ops end
        end
        clips[child.attrs.id] = { ops = table.concat(parts, ' '), evenodd = (child.children[1] and child.children[1].attrs['clip-rule'] == 'evenodd') }
      elseif child.name == 'marker' then
        markers[child.attrs.id] = child
      elseif child.name == 'defs' then
        definitions(child)
      end
    end
  end
  definitions(root)

  -- The figure in PDF: points from the lower left, so the SVG is turned upside down and moved to its view box.
  local frame = string.format('%s 0 0 %s 0 %s cm 1 0 0 1 %s %s cm', f(scale), f(-scale), f(height), f(-vx), f(-vy))

  -- Shapes are gathered into runs between texts. Each run becomes a form of its own with the graphics states it uses as its own resources, so
  -- transparency works without touching the resources of the page, which other packages such as TikZ fill as well.
  local run, runStates = {}, {}

  local function literal(body)
    run[#run + 1] = 'q ' .. body .. ' Q'
  end

  -- The name of a graphics state with this transparency for fills and strokes, made the first time it is needed.
  local function alphaState(fill, stroke)
    local key = string.format('%.3f/%.3f', fill, stroke)
    local state = graphicsStates[key]
    if not state then
      state = { name = 'sfa' .. (#graphicsStates.list + 1) }
      state.object = pdf.immediateobj(string.format('<< /Type /ExtGState /ca %s /CA %s >>', f(fill), f(stroke)))
      graphicsStates[key] = state
      graphicsStates.list[#graphicsStates.list + 1] = state
    end
    runStates[state.name] = state.object
    return '/' .. state.name .. ' gs'
  end

  local function flushRun()
    if #run == 0 then return end
    local resources = {}
    for name, object in pairs(runStates) do resources[#resources + 1] = string.format('/%s %d 0 R', name, object) end
    local content = 'q ' .. frame .. ' ' .. table.concat(run, ' ') .. ' Q'
    out[#out + 1] = string.format(
      '\\setbox\\stickyflowbox\\hbox to %sbp{\\vbox to %sbp{\\vss\\hbox{\\pdfextension literal{%s}}}\\hss}\\saveboxresource%s\\stickyflowbox\\rlap{\\useboxresource\\lastsavedboxresourceindex}',
      f(vw * scale), f(height), content, #resources > 0 and (' resources{/ExtGState << ' .. table.concat(resources, ' ') .. ' >>}') or ''
    )
    run, runStates = {}, {}
  end

  local function drawMarker(id, at, reverse)
    local marker = markers[id]
    if not marker or not at then return end
    local angle = math.atan(at[4], at[3])
    if reverse then angle = angle + math.pi end
    local c, s = math.cos(angle), math.sin(angle)
    for _, shape in ipairs(marker.children) do
      local ops = outline(shape)
      if ops then
        local fr, fg, fb, fa = color(shape.attrs.fill, gradients)
        local body = string.format('%s %s %s %s %s %s cm %s', f(c), f(s), f(-s), f(c), f(at[1]), f(at[2]), ops)
        if fr then
          local alpha = fa < 0.999 and (alphaState(fa, 1) .. ' ') or ''
          literal(string.format('%s%s %s %s rg %s f', alpha, f(fr), f(fg), f(fb), body))
        end
      end
    end
  end

  local function shape(node, inherited)
    local a = node.attrs
    if a.display == 'none' or a.visibility == 'hidden' then return end
    local ops, first, last = outline(node)
    if not ops then return end
    local opacity = num(a, 'opacity', 1) * inherited
    local parts = {}
    local clip = a['clip-path'] and a['clip-path']:match('url%(#(.-)%)')
    if clip and clips[clip] and clips[clip].ops ~= '' then
      parts[#parts + 1] = clips[clip].ops .. (clips[clip].evenodd and ' W* n' or ' W n')
    end
    local transform = transformOps(a.transform)
    if transform ~= '' then parts[#parts + 1] = transform end
    local fr, fg, fb, fa = color(a.fill or (node.name ~= 'path' and '#000000' or '#000000'), gradients)
    if a.fill == nil and node.name == 'path' then fr = 0 fg = 0 fb = 0 fa = 1 end
    local sr, sg, sb, sa = color(a.stroke, gradients)
    local strokeWidth = num(a, 'stroke-width', 1)
    local paint = nil
    local fillAlpha, strokeAlpha = 1, 1
    if fr then
      fillAlpha = fa * num(a, 'fill-opacity', 1) * opacity
      if fillAlpha > 0.002 then
        parts[#parts + 1] = string.format('%s %s %s rg', f(fr), f(fg), f(fb))
        paint = 'f'
      end
    end
    if sr and strokeWidth > 0 then
      strokeAlpha = sa * num(a, 'stroke-opacity', 1) * opacity
      if strokeAlpha > 0.002 then
        parts[#parts + 1] = string.format('%s %s %s RG %s w', f(sr), f(sg), f(sb), f(strokeWidth))
        local cap = ({ butt = 0, round = 1, square = 2 })[a['stroke-linecap'] or 'butt']
        local join = ({ miter = 0, round = 1, bevel = 2 })[a['stroke-linejoin'] or 'miter']
        parts[#parts + 1] = (cap or 0) .. ' J ' .. (join or 0) .. ' j'
        if a['stroke-dasharray'] and a['stroke-dasharray'] ~= 'none' then
          local dash = {}
          for _, n in ipairs(numbers(a['stroke-dasharray'])) do dash[#dash + 1] = f(n) end
          parts[#parts + 1] = '[' .. table.concat(dash, ' ') .. '] 0 d'
        end
        paint = paint == 'f' and 'B' or 'S'
      end
    end
    if paint then
      if fillAlpha < 0.999 or strokeAlpha < 0.999 then
        table.insert(parts, 1, alphaState(math.min(1, fillAlpha), math.min(1, strokeAlpha)))
      end
      parts[#parts + 1] = ops .. ' ' .. paint
      literal(table.concat(parts, ' '))
    end
    local function markerId(key)
      return a[key] and a[key]:match('url%(#(.-)%)')
    end
    if node.name == 'path' then
      drawMarker(markerId('marker-start'), first, true)
      drawMarker(markerId('marker-end'), last, false)
    end
  end

  local function text(node, inherited)
    local a = node.attrs
    local opacity = num(a, 'opacity', 1) * inherited
    local fr, fg, fb, fa = color(a.fill or '#000000', gradients)
    if not fr then return end
    local r, g, b = onWhite(fr, fg, fb, fa, opacity)
    local size = num(a, 'font-size', 16)
    local weight = a['font-weight'] or 'normal'
    local bold = weight == 'bold' or (tonumber(weight) or 400) >= 600
    local anchor = a['text-anchor'] or 'start'
    local x, y = num(a, 'x', 0), num(a, 'y', 0)
    local lines = {}
    for _, child in ipairs(node.children) do
      if child.name == 'tspan' then
        local content = {}
        for _, t in ipairs(child.children) do
          if t.name == '#text' then content[#content + 1] = t.text end
        end
        lines[#lines + 1] = { x = num(child.attrs, 'x', x), dy = num(child.attrs, 'dy', 0), size = num(child.attrs, 'font-size', size), text = table.concat(content) }
      elseif child.name == '#text' then
        lines[#lines + 1] = { x = x, dy = 0, size = size, text = child.text }
      end
    end
    local baseline = y
    for _, line in ipairs(lines) do
      baseline = baseline + line.dy
      if line.text:find('%S') then
        local px = (line.x - vx) * scale
        local py = height - (baseline - vy) * scale
        local box = string.format('{\\fontsize{%sbp}{%sbp}\\selectfont%s\\color[rgb]{%s}%s}', f(line.size * scale), f(line.size * scale * 1.2), bold and '\\bfseries' or '', rgbText(r, g, b), texEscape(line.text))
        local placed = anchor == 'middle' and ('\\hbox to 0pt{\\hss' .. box .. '\\hss}') or anchor == 'end' and ('\\hbox to 0pt{\\hss' .. box .. '}') or ('\\hbox to 0pt{' .. box .. '\\hss}')
        out[#out + 1] = string.format('\\rlap{\\kern%sbp\\raise%sbp%s}', f(px), f(py), placed)
      end
    end
  end

  local function walk(node, inherited)
    for _, child in ipairs(node.children or {}) do
      local name = child.name
      -- Controls such as sliders are for the live figure, not for print.
      if child.attrs and child.attrs['data-sf-role'] == 'widget' then
        name = nil
      end
      if name == 'g' then
        walk(child, inherited * num(child.attrs, 'opacity', 1))
      elseif name == 'text' then
        flushRun()
        text(child, inherited)
      elseif name == 'path' or name == 'rect' or name == 'ellipse' or name == 'circle' then
        shape(child, inherited)
      end
    end
  end
  walk(root, 1)
  flushRun()

  local box = string.format('\\hbox to %sbp{\\vbox to %sbp{\\vss\\hbox to %sbp{%s\\sffamily%s\\hss}}}', f(vw * scale), f(height), f(vw * scale), mark or '', table.concat(out))
  return box, vw * scale, height
end

---------------------------------------------------------------------------------------------------------------------------------------------
-- What the LaTeX package calls.

local function readFile(name)
  local path = kpse and kpse.find_file(name) or name
  local file = io.open(path or name, 'rb')
  if not file then error('stickyflow: cannot read ' .. name) end
  local text = file:read('a')
  file:close()
  return text
end

---------------------------------------------------------------------------------------------------------------------------------------------
-- Carrying the figures in the PDF, for the stickyflow extension: each figure with its page, its place in points from the lower left of the
-- page, its SFL and its data, in an attachment named stickyflow.json.

local figures = {}

-- Called when the page is written: the lower left corner of the figure is where TeX is now.
function stickyflow.place(index)
  local figure = figures[index]
  local x, y = pdf.getpos()
  local bp = 72 / 72.27 / 65536
  figure.page = status.total_pages
  figure.x, figure.y = x * bp, y * bp
end

local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }

local function jsonString(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    return escapes[c] or string.format('\\u%04x', c:byte())
  end) .. '"'
end

-- After the last page, when every figure has its place: the attachment, entered into the names of the PDF.
function stickyflow.embed()
  local placed = {}
  for _, figure in ipairs(figures) do
    if figure.page then
      local parts = {
        '"page":' .. figure.page,
        string.format('"rect":[%s,%s,%s,%s]', f(figure.x), f(figure.y), f(figure.width), f(figure.height)),
        '"sfl":' .. jsonString(figure.sfl),
      }
      if figure.data then parts[#parts + 1] = '"data":' .. figure.data end
      placed[#placed + 1] = '{' .. table.concat(parts, ',') .. '}'
    end
  end
  if #placed == 0 then return end
  local json = '{"version":1,"figures":[' .. table.concat(placed, ',') .. ']}'
  local stream = pdf.immediateobj('stream', json, '/Type /EmbeddedFile /Subtype /application#2Fjson')
  local spec = pdf.immediateobj(string.format('<< /Type /Filespec /F (stickyflow.json) /UF (stickyflow.json) /Desc (stickyflow figures) /EF << /F %d 0 R >> >>', stream))
  local names = pdf.immediateobj(string.format('<< /Names [(stickyflow.json) %d 0 R] >>', spec))
  tex.sprint(string.format('\\pdfextension names{/EmbeddedFiles %d 0 R}', names))
end

-- Typesets an SFL figure at the given width in points (bp), or at its own size. The data, if any, is the JSON of the rows of its data
-- sources.
function stickyflow.figure(source, width, data)
  local svg = stickyflow.render(source, data)
  local index = #figures + 1
  local box, w, h = stickyflow.draw(svg, width, '\\latelua{stickyflow.place(' .. index .. ')}')
  figures[index] = { sfl = source, data = data, width = w, height = h }
  tex.sprint(box)
end

-- SFL written in the document, between \begin{sfl}[width][data.json] and \end{sfl}. Every line passes this filter before TeX reads it: the
-- lines of the environment are kept as they are, so that braces, hashes and percent signs stay SFL, and the environment becomes one command
-- that draws them. TeX never sees the SFL, so it cannot read ahead into it.
local blocks = {}
local capturing

local function bracketed(text)
  local inner, rest = text:match('^%s*%[(.-)%](.*)$')
  return inner, rest or text
end

local function filter(line)
  if capturing then
    local from, to = line:find('\\end%s*{sfl}')
    if from then
      local head = line:sub(1, from - 1)
      if head:find('%S') then capturing.lines[#capturing.lines + 1] = head end
      blocks[#blocks + 1] = capturing
      local command = string.format('\\stickyflowblock{%d}{%s}{%s}', #blocks, capturing.width, capturing.data)
      capturing = nil
      return command .. line:sub(to + 1)
    end
    capturing.lines[#capturing.lines + 1] = line
    return '%'
  end
  local from, to = line:find('\\begin%s*{sfl}')
  if not from or line:sub(1, from - 1):find('%%') then return nil end
  local width, rest = bracketed(line:sub(to + 1))
  local data
  data, rest = bracketed(rest)
  capturing = { lines = {}, width = width and width ~= '' and width or '\\linewidth', data = data or '' }
  local head = line:sub(1, from - 1)
  if rest:find('%S') then capturing.lines[1] = rest end
  return head .. '%'
end

if luatexbase and luatexbase.add_to_callback then
  luatexbase.add_to_callback('process_input_buffer', filter, 'stickyflow.environment')
end

function stickyflow.block(index, width, dataName)
  local block = blocks[index]
  local data = dataName and dataName ~= '' and readFile(dataName) or nil
  stickyflow.figure(table.concat(block.lines, '\n'), width, data)
end

function stickyflow.figureFile(name, width, dataName)
  local data = dataName and dataName ~= '' and readFile(dataName) or nil
  stickyflow.figure(readFile(name), width, data)
end

return stickyflow
