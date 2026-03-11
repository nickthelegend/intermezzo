import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CreateAssetDto } from './create-asset.dto';
import { CreateAssetResponseDto } from './create-asset-response.dto';
import { UserInfoResponseDto } from './user-info-response.dto';
import { CreateUserDto } from './create-user.dto';
import { AssetTransferRequestDto } from './asset-transfer-request.dto';
import { AssetTransferResponseDto } from './asset-transfer-response.dto';
import { ManagerDetailDto } from './manager-detail.dto';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { AccountAssetsDto } from './account-assets.dto';
import { AssetClawbackRequestDto } from './asset-clawback-request.dto';
import { AlgoTransferRequestDto } from './algo-transfer-request.dto';
import { AlgoTransferResponseDto } from './algo-transfer-response.dto';
import { AssetHolding } from '../chain/algo-node-responses';
import { AppCallRequestDto } from './app-call-request.dto';
import { AppCallResponseDto } from './app-call-response.dto';
import { GroupRequestDto } from './group-request.dto';
import { GroupResponseDto } from './group-response.dto';
import * as algosdk from 'algosdk';

@ApiBearerAuth()
@Controller()
@ApiUnauthorizedResponse({
  description: 'Unauthorized',
})
export class Wallet {
  constructor(private readonly walletService: WalletService) { }

  // Endpoint to get user details
  @Get('wallet/users/:user_id/')
  @ApiOperation({
    summary: 'Get User by ID',
    description: 'Endpoint to get user details by User ID',
  })
  @ApiCreatedResponse({
    description: 'The access token has been successfully created.',
    type: UserInfoResponseDto,
  })
  async userDetail(@Request() request: any, @Param('user_id') user_id: string): Promise<UserInfoResponseDto> {
    return await this.walletService.getUserInfo(user_id, request.vault_token);
  }

  // Endpont to get manager details
  @Get('wallet/manager/')
  @ApiOperation({
    summary: 'Get Wallet Manager',
    description: 'Endpoint to get manager details, including the **Algorand** `public_address` of the **Manager**',
  })
  @ApiOkResponse({
    description: 'The details of the manager',
    type: ManagerDetailDto,
  })
  async managersDetail(@Request() request: any): Promise<ManagerDetailDto> {
    return await this.walletService.getManagerInfo(request.vault_token);
  }

  // Endpoint to fetch asset balance
  @Get('wallet/assets/:user_id')
  @ApiOperation({
    summary: 'Get Account Asset Holdings',
    description:
      'Fetch the account asset holdings for a user by their user ID. The response includes the **Algorand** `public_address` of the user and the list of assets held by the user.',
  })
  @ApiOkResponse({
    description: 'The asset balance has been successfully fetched.',
    type: AccountAssetsDto,
  })
  @ApiNotFoundResponse({
    description: 'Not Found',
  })
  @ApiBadRequestResponse({
    description: 'Bad Request',
  })
  async assetsBalances(@Request() request: any, @Param('user_id') user_id: string): Promise<AccountAssetsDto> {
    const accountAssets: AssetHolding[] = await this.walletService.getAssetHoldings(user_id, request.vault_token);
    const userPublicAddress: string = (await this.walletService.getUserInfo(user_id, request.vault_token))
      .public_address;
    const accountAssetsDto: AccountAssetsDto = {
      address: userPublicAddress,
      assets: accountAssets,
    };

    return accountAssetsDto;
  }

  @Post('wallet/user/')
  @ApiOperation({
    summary: 'Create User',
  })
  async userCreate(@Request() request: any, @Body() newUserParams: CreateUserDto): Promise<UserInfoResponseDto> {
    return this.walletService.userCreate(newUserParams.user_id, request.vault_token);
  }

  @Get('wallet/users/')
  @ApiOperation({
    summary: 'Get Users',
  })
  async userList(@Request() request: any): Promise<UserInfoResponseDto[]> {
    return this.walletService.getKeys(request.vault_token);
  }

  @Post('wallet/transactions/create-asset/')
  @ApiOperation({
    summary: 'Create Asset',
  })
  async createAsset(@Request() request: any, @Body() createAssetDto: CreateAssetDto): Promise<CreateAssetResponseDto> {
    return {
      transaction_id: await this.walletService.createAsset(createAssetDto, request.vault_token),
    };
  }

  @Post('wallet/transactions/transfer-asset/')
  @ApiOperation({
    summary: 'Transfer Asset',
  })
  async assetTransferTx(
    @Request() request: any,
    @Body() assetTransferRequestDto: AssetTransferRequestDto,
  ): Promise<AssetTransferResponseDto> {
    return {
      transaction_id: await this.walletService.transferAsset(
        request.vault_token,
        assetTransferRequestDto.assetId,
        assetTransferRequestDto.userId,
        assetTransferRequestDto.amount,
        assetTransferRequestDto.lease,
        assetTransferRequestDto.note,
      ),
    } as AssetTransferResponseDto;
  }

  @Post('wallet/transactions/transfer-algo/')
  @ApiOperation({
    summary: 'Transfer Algo',
  })
  async algoTransferTx(
    @Request() request: any,
    @Body() algoTransferRequestDto: AlgoTransferRequestDto,
  ): Promise<AlgoTransferResponseDto> {
    return {
      transaction_id: await this.walletService.transferAlgoToAddress(
        request.vault_token,
        algoTransferRequestDto.fromUserId,
        algoTransferRequestDto.toAddress,
        algoTransferRequestDto.amount,
        algoTransferRequestDto.fromAddress,
      ),
    } as AlgoTransferResponseDto;
  }

  @Post('wallet/transactions/clawback-asset/')
  @ApiOperation({
    summary: 'Clawback Asset',
  })
  async assetClawbackTx(
    @Request() request: any,
    @Body() assetClawbackRequestDto: AssetClawbackRequestDto,
  ): Promise<AssetTransferResponseDto> {
    return {
      transaction_id: await this.walletService.clawbackAsset(
        request.vault_token,
        assetClawbackRequestDto.assetId,
        assetClawbackRequestDto.userId,
        assetClawbackRequestDto.amount,
        assetClawbackRequestDto.lease,
        assetClawbackRequestDto.note,
      ),
    } as AssetTransferResponseDto;
  }

  @Post('wallet/transactions/app-call/')
  @ApiOperation({
    summary: 'App Call',
  })
  async appCallTx(@Request() request: any, @Body() appCallRequestDto: AppCallRequestDto): Promise<AppCallResponseDto> {
    return {
      transaction_id: await this.walletService.appCall(request.vault_token, appCallRequestDto),
    } as AppCallResponseDto;
  }

  @Post('wallet/transactions/group-transaction/')
  @ApiOperation({
    summary: 'Group Transaction',
  })
  async groupTx(@Request() request: any, @Body() groupRequestDto: GroupRequestDto) {
    return {
      group_id: await this.walletService.groupTransaction(request.vault_token, groupRequestDto),
    };
  }

  // --- NEW ENDPOINTS FOR KYUSO FRONTEND ---

  @Post('wallet')
  @ApiOperation({ summary: 'Kyuso: Initialize or Get Wallet' })
  async kyusoWalletInit(@Request() request: any) {
    const userId = request.user_id || 'default_user';
    try {
      return await this.walletService.getUserInfo(userId, request.vault_token);
    } catch (e) {
      return await this.walletService.userCreate(userId, request.vault_token);
    }
  }

  @Get('wallet/details')
  @ApiOperation({ summary: 'Kyuso: Get Wallet Details' })
  async kyusoWalletDetails(@Request() request: any) {
    const userId = request.user_id || 'default_user';
    return await this.walletService.getUserInfo(userId, request.vault_token);
  }

  @Get('wallet/assets')
  @ApiOperation({ summary: 'Kyuso: Get Wallet Assets' })
  async kyusoWalletAssets(@Request() request: any) {
    const userId = request.user_id || 'default_user';
    const accountAssets: AssetHolding[] = await this.walletService.getAssetHoldings(userId, request.vault_token);
    const userPublicAddress: string = (await this.walletService.getUserInfo(userId, request.vault_token))
      .public_address;
    return {
      address: userPublicAddress,
      assets: accountAssets,
    };
  }

  @Post('wallet/sign')
  @ApiOperation({ summary: 'Kyuso: Sign Transactions' })
  async kyusoSign(@Request() request: any, @Body() body: { transactions: string[], isMsgpack: boolean }) {
    const userId = request.user_id || 'default_user';
    const signedTxns = [];

    for (const txnBase64 of body.transactions) {
      try {
        const txnBytes = Buffer.from(txnBase64, 'base64');
        const txn = algosdk.decodeUnsignedTransaction(new Uint8Array(txnBytes));

        // txn.bytesToSign() handles "TX" prefix correctly
        const signMe = txn.bytesToSign();
        console.log(`[Sign] Signing ${signMe.length} bytes for user ${userId}`);

        const vaultRawSig: Buffer = await this.walletService.vaultService.signAsUser(userId, signMe, request.vault_token);
        const signatureStr = vaultRawSig.toString().split(':')[2];
        const signature = new Uint8Array(Buffer.from(signatureStr, 'base64'));

        // Combine signature with ORIGINAL transaction bytes
        const combined = this.walletService.chainService.addSignatureToTxn(new Uint8Array(txnBytes), signature);
        signedTxns.push(Buffer.from(combined).toString('base64'));
      } catch (e) {
        console.error(`[Sign] Error: ${e.message}`, e);
        throw e;
      }
    }

    return { signed_transactions: signedTxns };
  }
}
