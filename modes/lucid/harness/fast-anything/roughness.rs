//! Toroidal 3×3 roughness filter for Lucid's RGBA textures.

use napi::bindgen_prelude::*;
use napi_derive::napi;

const MIN_DEFAULT: f64 = 0.35;
const MAX_DEFAULT: f64 = 0.95;

fn number(value: Unknown) -> Result<f64> {
    value.coerce_to_number()?.get_double()
}

fn luminance(r: f64, g: f64, b: f64) -> f64 {
    (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
}

// ToIndex truncates fractional lengths, treats NaN as zero, and rejects infinity.
fn allocate<T: Default + Clone>(length: f64) -> Result<Vec<T>> {
    let length = if length.is_nan() { 0.0 } else { length.trunc() };
    if !(0.0..=9_007_199_254_740_991.0).contains(&length) {
        return Err(Error::from_reason("Invalid typed array length"));
    }
    let length = length as usize;
    let mut values = Vec::new();
    values
        .try_reserve_exact(length)
        .map_err(|_| Error::from_reason("Unable to allocate typed array"))?;
    values.resize(length, T::default());
    Ok(values)
}

fn luminance_field(env: &Env, image: &Object) -> Result<Vec<f64>> {
    let width: Unknown = image.get_named_property("width")?;
    let height: Unknown = image.get_named_property("height")?;
    let data: Unknown = image.get_named_property("data")?;
    let length = number(width)? * number(height)?;
    let mut values = allocate(length)?;
    if values.is_empty() {
        return Ok(values);
    }

    if data.is_typedarray()? {
        let view = TypedArray::from_unknown(data)?;
        if matches!(
            view.typed_array_type,
            TypedArrayType::Uint8 | TypedArrayType::Uint8Clamped
        ) {
            let bytes = &*view.arraybuffer;
            let mut pixels = bytes.chunks_exact(4);
            let count = values.len().min(pixels.len());
            for (value, rgba) in values[..count].iter_mut().zip(pixels.by_ref()) {
                *value = luminance(rgba[0] as f64, rgba[1] as f64, rgba[2] as f64);
            }
            if count < values.len() {
                values[count..].fill(f64::NAN);
                if let [r, g, b] = pixels.remainder() {
                    values[count] = luminance(*r as f64, *g as f64, *b as f64);
                }
            }
            return Ok(values);
        }
    }

    let data = data.coerce_to_object()?;
    let channel = |index: usize| {
        let value: Unknown = if let Ok(index) = u32::try_from(index) {
            data.get_element(index)?
        } else {
            data.get_named_property(&index.to_string())?
        };
        number(value)
    };
    for (i, value) in values.iter_mut().enumerate() {
        *value = env.run_in_scope(|| {
            let p = i * 4;
            Ok(luminance(channel(p)?, channel(p + 1)?, channel(p + 2)?))
        })?;
    }
    Ok(values)
}

fn wrap_index(value: f64, size: f64) -> f64 {
    let m = value % size;
    if m < 0.0 { m + size } else { m }
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.clamp(min, max)
}

fn to_byte(value: f64) -> f64 {
    // At -0.5 Math.round returns negative zero, which is observable in the stats.
    let rounded = if value == -0.5 { -0.0 } else { value.round() };
    clamp(rounded, 0.0, 255.0)
}

fn darkness(samples: [f64; 9], center: f64) -> f64 {
    let mut sum = 0.0;
    let mut squares = 0.0;
    for v in samples {
        sum += v;
        squares += v * v;
    }
    let mean = sum / 9.0;
    let variance = clamp(squares / 9.0 - mean * mean, 0.0, f64::INFINITY);
    let detail = clamp(variance.sqrt() / 0.25, 0.0, 1.0);
    clamp(0.65 * (1.0 - center) + 0.35 * detail, 0.0, 1.0)
}

struct Stats {
    min: f64,
    max: f64,
    total: f64,
}

impl Stats {
    fn record(&mut self, byte: f64) -> [u8; 4] {
        let stored = byte / 255.0;
        if stored < self.min {
            self.min = stored;
        }
        if stored > self.max {
            self.max = stored;
        }
        self.total += stored;
        [byte as u8, byte as u8, byte as u8, 255]
    }
}

fn render_rows(
    field: &[f64],
    width: usize,
    output: &mut [u8],
    stats: &mut Stats,
    mut map: impl FnMut(f64) -> Result<f64>,
) -> Result<()> {
    let last_row = field.len() - width;
    for (y, row) in output.chunks_exact_mut(width * 4).enumerate() {
        let start = y * width;
        let above = if start == 0 { last_row } else { start - width };
        let below = if start == last_row { 0 } else { start + width };
        let a = &field[above..above + width];
        let b = &field[start..start + width];
        let c = &field[below..below + width];
        for (x, rgba) in row.chunks_exact_mut(4).enumerate() {
            let left = if x == 0 { width - 1 } else { x - 1 };
            let right = if x + 1 == width { 0 } else { x + 1 };
            let d = darkness(
                [
                    a[left], a[x], a[right], b[left], b[x], b[right], c[left], c[x], c[right],
                ],
                b[x],
            );
            rgba.copy_from_slice(&stats.record(to_byte(map(d)? * 255.0)));
        }
    }
    Ok(())
}

fn array_index(value: f64, length: usize) -> Option<usize> {
    (value >= 0.0 && value < length as f64 && value.trunc() == value).then_some(value as usize)
}

struct Grid<'a> {
    width: Unknown<'a>,
    height: Unknown<'a>,
    field: &'a [f64],
    output: &'a mut [u8],
}

impl Grid<'_> {
    fn render(
        &mut self,
        env: &Env,
        stats: &mut Stats,
        mut map: impl FnMut(f64) -> Result<f64>,
    ) -> Result<()> {
        let numeric = self.width.get_type()? == ValueType::Number
            && self.height.get_type()? == ValueType::Number;
        type IndexFn<'a> = Function<'a, FnArgs<(f64, f64, Unknown<'a>, Unknown<'a>)>, f64>;
        enum Index<'a> {
            Numeric(f64, f64),
            Coerced(IndexFn<'a>),
        }
        let indexing = if numeric {
            let w = number(self.width)?;
            let h = number(self.height)?;
            if !(w > 0.0 && h > 0.0) {
                return Ok(());
            }
            if w.fract() == 0.0 && h.fract() == 0.0 && w * h == self.field.len() as f64 {
                return render_rows(self.field, w as usize, self.output, stats, map);
            }
            Index::Numeric(w, h)
        } else {
            // With nonnumeric sizes the additions can concatenate or call user-defined coercions.
            Index::Coerced(env.run_script(
                r#"(x, y, width, height) => {
                const wrap = (value, size) => {
                    const m = value % size;
                    return m < 0 ? m + size : m;
                };
                const i = wrap(y, height) * width + wrap(x, width);
                return typeof i === "string" && String(+i) !== i ? NaN : +i;
            }"#,
            )?)
        };
        let at = |x, y| -> Result<f64> {
            let index = match &indexing {
                Index::Coerced(f) => f.call((x, y, self.width, self.height).into())?,
                Index::Numeric(w, h) => wrap_index(y, *h) * w + wrap_index(x, *w),
            };
            Ok(array_index(index, self.field.len()).map_or(f64::NAN, |i| self.field[i]))
        };
        let mut y = 0.0;
        while y < number(self.height)? {
            let mut x = 0.0;
            while x < number(self.width)? {
                env.run_in_scope(|| {
                    let mut samples = [0.0; 9];
                    for (i, sample) in samples.iter_mut().enumerate() {
                        *sample = at(x + (i % 3) as f64 - 1.0, y + (i / 3) as f64 - 1.0)?;
                    }
                    let center = if numeric { samples[4] } else { at(x, y)? };
                    let d = darkness(samples, center);
                    let rgba = stats.record(to_byte(map(d)? * 255.0));
                    let p = (y * number(self.width)? + x) * 4.0;
                    for (offset, byte) in rgba.into_iter().enumerate() {
                        if let Some(i) = array_index(p + offset as f64, self.output.len()) {
                            self.output[i] = byte;
                        }
                    }
                    Ok(())
                })?;
                x += 1.0;
            }
            y += 1.0;
        }
        Ok(())
    }
}

#[napi(js_name = "roughnessMap", catch_unwind)]
pub fn roughness_map<'a>(
    env: &'a Env,
    image: Unknown<'a>,
    options: Unknown<'a>,
) -> Result<Object<'a>> {
    let options = if options.get_type()? == ValueType::Undefined {
        Object::new(env)?
    } else {
        options.coerce_to_object()?
    };
    let option = |name, default| -> Result<Unknown> {
        let value: Unknown = options.get_named_property(name)?;
        Ok(if value.get_type()? == ValueType::Undefined {
            env.create_double(default)?.to_unknown()
        } else {
            value
        })
    };
    let min = option("min", MIN_DEFAULT)?;
    let max = option("max", MAX_DEFAULT)?;
    let invert = options
        .get_named_property::<Unknown>("invert")?
        .coerce_to_bool()?;

    let image = image.coerce_to_object()?;
    let width: Unknown = image.get_named_property("width")?;
    let height: Unknown = image.get_named_property("height")?;
    let field = luminance_field(env, &image)?;
    let count = number(width)? * number(height)?;
    let mut bytes = allocate(count * 4.0)?;
    let mut grid = Grid {
        width,
        height,
        field: &field,
        output: bytes.as_mut(),
    };
    let mut stats = Stats {
        min: f64::INFINITY,
        max: f64::NEG_INFINITY,
        total: 0.0,
    };

    if min.get_type()? == ValueType::Number && max.get_type()? == ValueType::Number {
        let min = number(min)?;
        let range = number(max)? - min;
        grid.render(env, &mut stats, |d| {
            Ok(min + range * if invert { 1.0 - d } else { d })
        })?;
    } else {
        // Keep ToPrimitive, string addition, and user-defined conversions at the JS boundary.
        let remap: Function<FnArgs<(Unknown, Unknown, f64)>, f64> =
            env.run_script("(min,max,t) => +(min + (max-min)*t)")?;
        grid.render(env, &mut stats, |d| {
            env.run_in_scope(|| remap.call((min, max, if invert { 1.0 - d } else { d }).into()))
        })?;
    }

    let mut result_image = Object::new(env)?;
    result_image.set("width", width)?;
    result_image.set("height", height)?;
    result_image.set("data", Uint8Array::new(bytes))?;
    result_image.set("hasAlpha", false)?;
    let mut result_stats = Object::new(env)?;
    result_stats.set("min", stats.min)?;
    result_stats.set("max", stats.max)?;
    result_stats.set("mean", stats.total / (number(width)? * number(height)?))?;
    let mut result = Object::new(env)?;
    result.set("image", result_image)?;
    result.set("stats", result_stats)?;
    Ok(result)
}
