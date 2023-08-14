import { S3 } from "aws-sdk";
import { File, UploadedFile } from "../../models/file";
import { FileUploader } from "./base";

export class AWSFileUploader implements FileUploader {
    private client: S3;

    private readonly bucketName = process.env.AWS_CONFIG_BUCKETNAME;

    constructor() {

       /* console.log("TTTTTTTTTTTTTTTTTTTTTTTTTTT");

        console.log(process.env.AWS_CONFIG_DEFAULT_REGION);
        console.log(process.env.AWS_CONFIG_SECRET_KEY);
        console.log(process.env.AWS_CONFIG_ACCESS_KEY); */

        this.client = new S3({
            region: process.env.AWS_CONFIG_DEFAULT_REGION,
            secretAccessKey: process.env.AWS_CONFIG_SECRET_KEY,
            accessKeyId: process.env.AWS_CONFIG_ACCESS_KEY
        });
    }

    private generateFileKey(file: File, timestamp: number): string {
        // return `${file.name}-${timestamp}.${file.extension}`;
        return `${file.name}_${timestamp}.${file.extension}`;
    }

    private async uploadFile(file: File): Promise<string> {
        const timestamp = Date.now();
        const fileKey = this.generateFileKey(file, timestamp);
        const result = await this.client
            .upload({
                Bucket: this.bucketName,
                Key: fileKey,
                ContentType: file.type,
                Body: file.content
            })
            .promise();

        return result.Location;
    }

    async deleteFile(fileName: string, length: number): Promise<Boolean> {
        try {
            /*
            fileName
            */
            let pathArr = fileName.split("/");
            let fileKey = (pathArr.slice(pathArr.length - length, pathArr.length)).join('/');

            await this.client
                .deleteObject({
                    Bucket: this.bucketName,
                    Key: fileKey
                }).promise();

            return true;
        }
        catch(ex) {
            return false;
        }
    }

    async upload(
        files: File | File[]
    ): Promise<UploadedFile | UploadedFile[] | undefined> {
        try {
            if (Array.isArray(files)) {
                const paths = await Promise.all(
                    files.map(async (file) => this.uploadFile(file))
                );
                return paths.map((path) => ({ path }));
            }

            const path = await this.uploadFile(files);
            return {
                path,
            };
        } catch (ex) {
            console.log(ex);
            return undefined;
        }
    }


    private async uploadTempFile(file: File): Promise<string> {
        // const timestamp = Date.now();
        
        // const fileKey = this.generateFileKey(file, timestamp);

        const result = await this.client
            .upload({
                Bucket: this.bucketName,
                Key: file.name,
                ContentType: file.type,
                Body: file.content
            })
            .promise();

        return result.Location;
    }

    async upload_temp(
        files: File | File[]
    ): Promise<UploadedFile | UploadedFile[] | undefined> {
        try {
            if (Array.isArray(files)) {
                const paths = await Promise.all(
                    files.map(async (file) => this.uploadTempFile(file))
                );
                return paths.map((path) => ({ path }));
            }

            const path = await this.uploadTempFile(files);
            return {
                path,
            };
        }
        catch(ex) {
            console.log(ex);
            return undefined;           
        }
    }
}