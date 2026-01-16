import { AssetHolding } from 'src/chain/algo-node-responses';

export abstract class AccountAssetsDto {
  address: string;
  assets: AssetHolding[];
}
