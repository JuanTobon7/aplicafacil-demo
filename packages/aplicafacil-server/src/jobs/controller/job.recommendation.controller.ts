import { Body, Controller, Post, Res } from "@nestjs/common";
import { FillFormRequestDto } from "../dto/req/fill.form.request.dto";
import { JobRecommendationService } from "../service/contract/job.recommendation.service";

@Controller('/recommendations')
export class JobRecommendationController {
    constructor(
        private readonly service: JobRecommendationService,
    ) {}

    @Post()
    getRecommendations(
        @Body() body: FillFormRequestDto,
        @Res() res
    ) {
        const response = this.service.fillFormFields(body);
        response.then(r => { 
            res.status(200).json({
                message: 'Recomendaciones generadas exitosamente',
                recommendations: r.fields
            });
        }).catch(
            e => {
                console.error(e);
                res.status(500).json({
                    message: 'Error al generar recomendaciones',
                    error: e.message
                });
            }
        );
        
    }
}