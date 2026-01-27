import { IsArray, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AppCallRequestDto } from './app-call-request.dto';
import { CreateAssetDto } from './create-asset.dto';
// import { AssetFreezeRequestDto } from './asset-freeze-request.dto';
import { AssetTransferRequestDto } from './asset-transfer-request.dto';
// import { KeyRegistrationRequestDto } from './key-registration-request.dto';
import { AlgoTransferRequestDto } from './algo-transfer-request.dto';
import { AssetClawbackRequestDto } from './asset-clawback-request.dto';

export class GroupRequestDto {

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    @ApiProperty({
      required: false,
      example: ['payment', 'appCall', 'assetTransfer'],
      description:
        'Optional explicit order of transactions to include in the atomic group. Values must match the request property names (e.g. appCall, assetConfig, assetTransfer, payment, assetClawback). If omitted, a default order is used.',
    })
    sequence?: Array<'appCall' | 'assetConfig' | 'assetTransfer' | 'payment' | 'assetClawback'>;


    appCall: AppCallRequestDto;
    assetConfig: CreateAssetDto;
    assetTransfer: AssetTransferRequestDto;
    payment: AlgoTransferRequestDto;
    assetClawback: AssetClawbackRequestDto;
}