#!/usr/bin/env swift
import Foundation
import Security

// Secret values enter and leave through standard streams, never process arguments.
// (ADR-004 cap § updater v9)

enum KeychainError: Error {
    case usage
    case emptySecret
    case osStatus(OSStatus)
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(("error: \(message)\n").utf8))
    exit(1)
}

guard CommandLine.arguments.count == 4 else {
    fail("usage: keychain-secret.swift <add|read> <service> <account>")
}
let operation = CommandLine.arguments[1]
let service = CommandLine.arguments[2]
let account = CommandLine.arguments[3]
let query: [CFString: Any] = [
    kSecClass: kSecClassGenericPassword,
    kSecAttrService: service,
    kSecAttrAccount: account,
]

switch operation {
case "add":
    let secret = FileHandle.standardInput.readDataToEndOfFile()
    guard !secret.isEmpty else {
        fail("refusing to store an empty Keychain secret")
    }
    var item = query
    item[kSecValueData] = secret
    item[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlock
    let addStatus = SecItemAdd(item as CFDictionary, nil)
    if addStatus != errSecSuccess {
        fail("could not add Keychain item (OSStatus \(addStatus))")
    }
case "read":
    var lookup = query
    lookup[kSecReturnData] = true
    lookup[kSecMatchLimit] = kSecMatchLimitOne
    var result: CFTypeRef?
    let readStatus = SecItemCopyMatching(lookup as CFDictionary, &result)
    guard readStatus == errSecSuccess, let secret = result as? Data, !secret.isEmpty else {
        fail("could not read Keychain item (OSStatus \(readStatus))")
    }
    FileHandle.standardOutput.write(secret)
default:
    fail("usage: keychain-secret.swift <add|read> <service> <account>")
}
