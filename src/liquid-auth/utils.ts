// Temporary file until we start using Vault for secure key management
// Delete this file and uninstall @scure packages when done

import * as bip39 from '@scure/bip39';
import { sha512_256 } from '@noble/hashes/sha2.js';
import { base32 } from '@scure/base';
import { fromSeed, XHDWalletAPI, KeyContext, BIP32DerivationType } from '@algorandfoundation/xhd-wallet-api';
/**
 * HD Wallet utilities for Algorand key derivation using xHD-Wallet-API
 */

/**
 * Creates a root key from a BIP39 mnemonic phrase
 * @param mnemonic BIP39 mnemonic phrase
 * @param passphrase Optional passphrase (empty string by default)
 * @returns Uint8Array (96 bytes)
 */
export const createRootKeyFromMnemonic = (mnemonic: string, passphrase: string = ''): Uint8Array => {
  const seed = bip39.mnemonicToSeedSync(mnemonic, passphrase);
  return fromSeed(Buffer.from(seed));
};

/**
 * HD Wallet service for key generation and derivation
 */
export class HDWalletService {
  private cryptoService: XHDWalletAPI;
  private rootKey: Uint8Array;

  constructor(rootKey: Uint8Array) {
    this.cryptoService = new XHDWalletAPI();
    this.rootKey = rootKey;
  }

  static fromMnemonic(mnemonic: string, passphrase: string = ''): HDWalletService {
    const rootKey = createRootKeyFromMnemonic(mnemonic, passphrase);
    return new HDWalletService(rootKey);
  }

  static fromRootKey(precomputedRootKey: Uint8Array): HDWalletService {
    return new HDWalletService(precomputedRootKey);
  }

  async generateAlgorandAddressKey(
    account: number,
    addressIndex: number,
    derivationType: BIP32DerivationType = BIP32DerivationType.Peikert,
  ): Promise<Uint8Array> {
    return this.cryptoService.keyGen(this.rootKey, KeyContext.Address, account, addressIndex, derivationType);
  }

  async generateIdentityKey(
    account: number,
    addressIndex: number,
    derivationType: BIP32DerivationType = BIP32DerivationType.Peikert,
  ): Promise<Uint8Array> {
    return await this.cryptoService.keyGen(this.rootKey, KeyContext.Identity, account, addressIndex, derivationType);
  }

  getRootKey(): Uint8Array {
    return this.rootKey;
  }

  getCryptoService(): XHDWalletAPI {
    return this.cryptoService;
  }

  async signAlgorandTransaction(
    account: number,
    addressIndex: number,
    prefixEncodedTx: Uint8Array,
    derivationType: BIP32DerivationType = BIP32DerivationType.Peikert,
  ): Promise<Uint8Array> {
    return await this.cryptoService.signAlgoTransaction(
      this.rootKey,
      KeyContext.Address,
      account,
      addressIndex,
      prefixEncodedTx,
      derivationType,
    );
  }
}

/**
 * Encodes a public key into a Base32 Algorand address, which includes a checksum at the end
 * @param publicKey Public key as Uint8Array (32 bytes)
 * @returns Algorand Address
 */
export function encodeAddress(publicKey: Uint8Array): string {
  const hash = sha512_256(publicKey); // 32 bytes
  const checksum = hash.slice(-4); // last 4 bytes
  const addressBytes = new Uint8Array([...publicKey, ...checksum]);
  return base32.encode(addressBytes).replace(/=+$/, '').toUpperCase();
}

/**
 * Convenience helper: derive an Algorand address from a BIP39 mnemonic.
 * Returns the Base32-encoded Algorand address for account 0 / index 0.
 */
export async function getAddressFromMnemonic(mnemonic: string, account = 0, index = 0): Promise<string> {
  const root = createRootKeyFromMnemonic(mnemonic);
  const wallet = new HDWalletService(root);
  const key = await wallet.generateAlgorandAddressKey(account, index);
  return encodeAddress(key);
}
