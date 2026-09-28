import { BadRequestException, Controller, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import sharp = require('sharp');
import { createHash } from 'node:crypto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { RuntimeMaintenanceGuard } from '../runtime-maintenance.guard';
import { DeviceDispatchService } from '../../../core/runtime/device-dispatch.service';
import { ok } from '../../../common/dto/api-response.dto';

@Controller('api/v1/runtime/devices')
@UseGuards(JwtAuthGuard, RuntimeMaintenanceGuard)
export class DeviceCalibrationController {
  constructor(private readonly dispatch:DeviceDispatchService) {}
  @Post(':deviceId/calibrate')
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:8*1024*1024,files:1}}))
  async calibrate(@Param('deviceId') deviceId:string,@UploadedFile() file:{buffer:Buffer;mimetype:string},@Req() request:AuthenticatedRequest) {
    if(!file?.buffer?.length||!['image/png','image/jpeg','image/webp'].includes(file.mimetype))throw new BadRequestException('CALIBRATION_IMAGE_REQUIRED');
    const parameters={box:{x:0,y:0,width:1,height:1},paddingRatio:0.05,targetSize:512,jpegQuality:90};
    const reference=await sharp(file.buffer,{limitInputPixels:16*1024*1024}).resize({width:512,height:512,fit:'contain',background:{r:245,g:245,b:245,alpha:1}}).jpeg({quality:90,mozjpeg:true}).toBuffer();
    const expected=createHash('sha256').update(reference).digest('hex');
    const result=await this.dispatch.calibrate(deviceId,request.user!.userId,file.buffer,parameters,AbortSignal.timeout(60000));
    const actual=createHash('sha256').update(result.buffer).digest('hex');
    return ok({deviceId,capability:'image.crop.v1',matchesLocalReference:actual===expected,inputBytes:file.buffer.length,outputBytes:result.buffer.length,
      qualityGateChanged:false,businessStateChanged:false});
  }
}
