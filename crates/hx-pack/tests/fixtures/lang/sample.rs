//! Sample module for outline tests.

use std::fmt;

/// A point in the plane.
#[derive(Debug, Clone)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

pub enum Shape {
    Circle(f64),
    Square(f64),
}

/// Anything with an area.
pub trait Area {
    fn area(&self) -> f64;
    fn name(&self) -> String {
        String::from("shape")
    }
}

impl Point {
    /// The origin.
    pub const fn origin() -> Self {
        Self { x: 0.0, y: 0.0 }
    }

    pub fn distance(
        &self,
        other: &Point,
    ) -> f64 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        fn square(v: f64) -> f64 {
            v * v
        }
        (square(dx) + square(dy)).sqrt()
    }
}

impl fmt::Display for Point {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "({}, {})", self.x, self.y)
    }
}

pub type Pair = (Point, Point);

const LIMIT: usize = 10;
static GREETING: &str = "hello";

macro_rules! twice {
    ($e:expr) => {
        $e + $e
    };
}

pub mod geometry {
    pub fn unit() -> f64 {
        1.0
    }
}
