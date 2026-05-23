//! Host/port formatting helpers shared by the connect path and the on-disk
//! known_hosts store.
//!
//! IPv6 literals contain colons, so the naive `format!("{host}:{port}")` is
//! ambiguous for them: `::1:22` could be parsed as port 22 on `::1` or as
//! address `::1:22` with no port. The fix is to bracket IPv6 literals
//! whenever they're combined with a port, matching the convention used by
//! URLs, OpenSSH, and `std::net::ToSocketAddrs`.
//!
//! We also accept user input in either bracketed (`[::1]`) or bare (`::1`)
//! form and canonicalize to bare-internally / bracketed-when-paired-with-port,
//! so the same session works regardless of how the user typed the address.

use std::net::Ipv6Addr;

/// Strip optional surrounding `[..]` brackets. Returns the inner string only
/// if both brackets are present; otherwise returns the original.
fn strip_brackets(host: &str) -> &str {
    if let Some(rest) = host.strip_prefix('[') {
        if let Some(inner) = rest.strip_suffix(']') {
            return inner;
        }
    }
    host
}

/// True if `host` parses as an IPv6 address, with or without surrounding
/// brackets. Hostnames (`example.com`), IPv4 (`1.2.3.4`), and gibberish all
/// return false.
pub fn is_ipv6_literal(host: &str) -> bool {
    strip_brackets(host).parse::<Ipv6Addr>().is_ok()
}

/// Normalize a user-entered host string for internal storage. Brackets are
/// stripped from IPv6 literals (so `[::1]` and `::1` become the same value);
/// everything else passes through unchanged.
///
/// We deliberately don't lowercase or compress IPv6 here — `Ipv6Addr`'s
/// canonical `Display` would do that, but it also rewrites `::1` to `::1`
/// and `2001:db8::1` to `2001:db8::1`, which is fine, but it would also
/// turn `2001:0db8::1` into `2001:db8::1`. That's *correct* canonicalization
/// but it would surprise a user who typed the long form and then sees a
/// different string in their session list. Stick with the user's spelling.
pub fn normalize_host(host: &str) -> String {
    let stripped = strip_brackets(host);
    if stripped.parse::<Ipv6Addr>().is_ok() {
        stripped.to_string()
    } else {
        host.to_string()
    }
}

/// Format a `host` + `port` as a connectable socket address string. IPv6
/// literals get bracketed; IPv4 and hostnames are left unbracketed. Accepts
/// either bracketed or bare IPv6 input.
///
/// Examples:
///   ("example.com", 22)    -> "example.com:22"
///   ("1.2.3.4", 22)        -> "1.2.3.4:22"
///   ("::1", 22)            -> "[::1]:22"
///   ("[::1]", 22)          -> "[::1]:22"
///   ("2001:db8::1", 22)    -> "[2001:db8::1]:22"
pub fn format_socket_addr(host: &str, port: u16) -> String {
    if is_ipv6_literal(host) {
        format!("[{}]:{}", strip_brackets(host), port)
    } else {
        format!("{host}:{port}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipv6_detection() {
        assert!(is_ipv6_literal("::1"));
        assert!(is_ipv6_literal("[::1]"));
        assert!(is_ipv6_literal("2001:db8::1"));
        assert!(is_ipv6_literal("[2001:db8::1]"));
        assert!(is_ipv6_literal("fe80::1"));

        assert!(!is_ipv6_literal("1.2.3.4"));
        assert!(!is_ipv6_literal("example.com"));
        assert!(!is_ipv6_literal(""));
        assert!(!is_ipv6_literal("[::1"));
        assert!(!is_ipv6_literal("::1]"));

        // "::1:22" IS a valid IPv6 address (0:0:0:0:0:0:1:22). That isn't a
        // problem here because the user always supplies host and port via
        // separate fields -- there's no parser at this layer that needs to
        // split the colon-port suffix off of a bare IPv6 string.
        assert!(is_ipv6_literal("::1:22"));
    }

    #[test]
    fn normalize_strips_v6_brackets_only() {
        assert_eq!(normalize_host("[::1]"), "::1");
        assert_eq!(normalize_host("::1"), "::1");
        assert_eq!(normalize_host("[2001:db8::1]"), "2001:db8::1");
        assert_eq!(normalize_host("example.com"), "example.com");
        assert_eq!(normalize_host("1.2.3.4"), "1.2.3.4");
        // Brackets around non-IPv6 are NOT stripped -- the brackets are
        // suspicious enough that leaving them in lets the user see what
        // they typed in the session list.
        assert_eq!(normalize_host("[example.com]"), "[example.com]");
    }

    #[test]
    fn socket_addr_brackets_v6_only() {
        assert_eq!(format_socket_addr("example.com", 22), "example.com:22");
        assert_eq!(format_socket_addr("1.2.3.4", 22), "1.2.3.4:22");
        assert_eq!(format_socket_addr("::1", 22), "[::1]:22");
        assert_eq!(format_socket_addr("[::1]", 22), "[::1]:22");
        assert_eq!(
            format_socket_addr("2001:db8::1", 2222),
            "[2001:db8::1]:2222"
        );
        assert_eq!(format_socket_addr("fe80::1", 22), "[fe80::1]:22");
    }

    /// The bracketed form must be parseable by `std::net::ToSocketAddrs` --
    /// that's what `russh::client::connect` ultimately calls.
    #[test]
    fn formatted_addr_resolves() {
        use std::net::ToSocketAddrs;
        let s = format_socket_addr("::1", 22);
        let addrs: Vec<_> = s.to_socket_addrs().unwrap().collect();
        assert!(!addrs.is_empty(), "[::1]:22 should resolve");
    }
}
